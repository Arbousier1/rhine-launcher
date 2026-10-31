import type { Context } from '@deepseek-ai/cordis'
import { spawn, type ChildProcess } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { mkdir, readFile, readdir, stat, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { DiagnosticsApi, LaunchApi, RawVersionJson, TaskHandle } from '../contracts.ts'
import type { Instance, LaunchRequest, LaunchSession, LogLine } from '../types.ts'
import {
  buildCommand, classpathFromPlans, planLibraries, LAUNCHER_BRAND, LAUNCHER_VERSION,
  type LibraryPlan,
} from '../runtime/command.ts'
import { currentPlatform, type PlatformInfo } from '../runtime/rules.ts'
import { extractNatives } from '../runtime/natives.ts'
import { analyzeCrash, type CrashFinding } from '../runtime/crash.ts'
import { ensureAuthlibInjector } from '../accounts/authlib-injector.ts'

/** File that keeps the launch session table on disk. */
export const SESSION_FILE = 'launch-sessions.json'

/** Maximum number of log lines buffered per session in memory. */
export const MAX_LOG_LINES = 4000

/** Directory (inside an instance) that holds launcher-owned data. */
export const RHINE_DIR = '.rhine'

/** Raised when a launch cannot be prepared. */
export class LaunchError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LaunchError'
  }
}

/** Everything a launch needs after resolution. */
export interface PreparedLaunch {
  instance: Instance
  version: RawVersionJson
  versionId: string
  javaPath: string
  javaMajor: number
  plans: LibraryPlan[]
  classpath: string[]
  nativesDir: string
  loggingFile?: string
  command: string[]
  mainClass: string
  cwd: string
  auth: { username: string; uuid: string; accessToken: string; userType: string; xuid?: string; clientId?: string }
  memory: { minMb: number; maxMb: number }
  window: { width: number; height: number; fullscreen: boolean }
}

/** Normalise an ISO timestamp into a file-system safe log name. */
export function logFileStamp(date = new Date()): string {
  return date.toISOString().replace(/[:.]/g, '-').replace('T', '_').replace('Z', '')
}

/** Undash and lowercase a UUID for `--uuid` . */
export function compactUuid(uuid: string): string {
  return uuid.replace(/-/g, '').toLowerCase()
}

/** Pick the java major version a version json demands. */
export function requiredJavaMajor(version: RawVersionJson, gameVersion: string): number {
  const declared = version.javaVersion?.majorVersion
  if (typeof declared === 'number' && declared > 0) return declared
  // Fallback table for pre-1.17 manifests that never declared javaVersion.
  const parse = /^(\d+)(?:\.(\d+))?(?:\.(\d+))?/.exec(gameVersion ?? '')
  if (!parse) return 8
  const major = Number(parse[1])
  const minor = Number(parse[2] ?? 0)
  const patch = Number(parse[3] ?? 0)
  // Snapshots use the new "26.3" calendar scheme and always need a modern JRE.
  if (major > 1) return 21
  if (minor >= 21) return 21
  if (minor === 20 && patch >= 5) return 21
  if (minor >= 18) return 17
  if (minor >= 17) return 16
  return 8
}

/**
 * Launch Minecraft for an instance.
 *
 * The service owns three responsibilities: resolving a complete launch plan
 * (version json, java, libraries, natives, logging config), spawning the game
 * process detached with its output captured, and tracking the session until the
 * process exits.
 */
export class LaunchService implements LaunchApi {
  static inject = ['paths', 'storage', 'bus', 'tasks', 'download', 'meta', 'instances', 'accounts', 'java', 'settings']

  private sessionsById = new Map<string, LaunchSession>()
  private processes = new Map<string, ChildProcess>()
  private logs = new Map<string, LogLine[]>()
  private loaded = false
  private seq = 0
  private platform: PlatformInfo = currentPlatform()

  constructor(protected ctx: Context) {
  }

  /* ---------------------------------------------------------------- */
  /* public API                                                        */
  /* ---------------------------------------------------------------- */

  async launch(request: LaunchRequest): Promise<LaunchSession> {
    this.ensureLoaded()
    const instance = this.ctx.instances.get(request.instanceId)
    if (!instance) throw new LaunchError('实例不存在：' + request.instanceId)

    const taskId = this.ctx.tasks.run('启动 ' + instance.name, 'launch', async (handle) => {
      const prepared = await this.prepare(request, handle)
      await this.spawn(prepared, request, handle)
    })
    const result = await this.ctx.tasks.wait(taskId)
    if (result.status === 'failed') throw new LaunchError(result.error ?? '启动失败')
    if (result.status === 'cancelled') throw new LaunchError('启动已取消')
    const session = this.lastSessionOf(instance.id)
    if (!session) throw new LaunchError('启动失败：没有创建游戏进程')
    return session
  }

  sessions(): LaunchSession[] {
    this.ensureLoaded()
    return [...this.sessionsById.values()].sort((a, b) => b.startedAt - a.startedAt)
  }

  session(id: string): LaunchSession | undefined {
    this.ensureLoaded()
    return this.sessionsById.get(id)
  }

  async kill(sessionId: string): Promise<void> {
    this.ensureLoaded()
    const session = this.sessionsById.get(sessionId)
    if (!session) throw new LaunchError('会话不存在：' + sessionId)
    const child = this.processes.get(sessionId)
    if (!child || child.exitCode !== null || child.signalCode) {
      throw new LaunchError('该会话已经结束')
    }
    session.status = 'stopped'
    this.publish(session)
    try {
      if (process.platform === 'win32' && child.pid) {
        // A detached Windows process has no signal support; taskkill reaches
        // the whole tree so the game cannot leave orphan JVM children behind.
        spawn('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
      } else {
        child.kill('SIGTERM')
        setTimeout(() => {
          if (child.exitCode === null) child.kill('SIGKILL')
        }, 5000).unref()
      }
    } catch (error) {
      throw new LaunchError('结束进程失败：' + (error as Error).message)
    }
  }

  async buildCommand(request: LaunchRequest): Promise<{ command: string[]; cwd: string; mainClass: string }> {
    const prepared = await this.prepare(request, undefined, { skipDownloads: true })
    return { command: prepared.command, cwd: prepared.cwd, mainClass: prepared.mainClass }
  }

  log(sessionId: string, tail = 500): LogLine[] {
    this.ensureLoaded()
    const lines = this.logs.get(sessionId) ?? []
    return tail > 0 ? lines.slice(-tail) : [...lines]
  }

  /* ---------------------------------------------------------------- */
  /* preparation                                                       */
  /* ---------------------------------------------------------------- */

  /**
   * Resolve everything needed to start the game.
   *
   * `skipDownloads` is used by `buildCommand` so the UI can preview the
   * command line without touching the disk or the network.
   */
  async prepare(
    request: LaunchRequest,
    handle?: TaskHandle,
    options: { skipDownloads?: boolean } = {},
  ): Promise<PreparedLaunch> {
    const instance = this.ctx.instances.get(request.instanceId)
    if (!instance) throw new LaunchError('实例不存在：' + request.instanceId)

    handle?.setProgress({ stage: 'resolve', current: 0, total: 1, value: 0, message: '解析版本' })
    const versionId = await this.resolveVersionId(instance)
    const version = await this.ctx.meta.resolvedJson(versionId)
    if (!version) throw new LaunchError('找不到版本文件：' + versionId)

    const account = await this.ctx.accounts.authorize(request.accountId)
    if (!account) throw new LaunchError('账号不存在：' + request.accountId)

    const javaMajor = requiredJavaMajor(version, instance.gameVersion)
    const runtime = await this.resolveJava(request, instance, javaMajor, handle)

    const memory = {
      minMb: instance.memory.minMb,
      maxMb: request.memoryMb && request.memoryMb > 0 ? request.memoryMb : instance.memory.maxMb,
    }
    const window = instance.window ?? { width: 1280, height: 720, fullscreen: false }
    const librariesDir = this.ctx.paths.get().libraries
    const assetsDir = this.ctx.paths.get().assets
    const nativesDir = join(instance.path, 'natives')
    const plans = planLibraries(version.libraries, this.platform, librariesDir)
    const versionJar = this.versionJarPath(versionId, version)

    if (!options.skipDownloads) {
      await this.ensureLibraries(plans, handle)
      await this.extract(plans, nativesDir, handle)
      await this.ensureAssets(version, assetsDir, handle)
    }
    const loggingFile = options.skipDownloads
      ? undefined
      : await this.ensureLogging(version, instance, handle)

    const extraJvm = [...(request.extraJvmArgs ?? [])]
    if (account.kind === 'authlib-injector' && account.authServerUrl) {
      const injectorJar = await ensureAuthlibInjector(librariesDir, this.ctx.download)
      extraJvm.push(`-javaagent:${injectorJar}=${account.authServerUrl}`)
    }

    const classpath = classpathFromPlans(plans, versionJar)
    const built = buildCommand({
      version,
      versionName: versionId,
      instance,
      gameDir: instance.path,
      assetsDir,
      librariesDir,
      classpath,
      versionJar,
      nativesDir,
      javaPath: runtime.path,
      javaMajor: runtime.majorVersion,
      memory,
      window: request.memoryMb ? { ...window } : window,
      jvmExtra: extraJvm,
      gameExtra: request.extraGameArgs,
      auth: {
        username: account.name,
        uuid: compactUuid(account.uuid),
        accessToken: account.accessToken ?? '0',
        userType: account.kind === 'microsoft' ? 'msa' : account.kind === 'authlib-injector' ? 'mojang' : 'legacy',
        xuid: (account as any).xuid,
        clientId: (account as any).clientId,
        userProperties: '{}',
      },
      launcher: { name: LAUNCHER_BRAND, version: LAUNCHER_VERSION },
      loggingFile,
      platform: this.platform,
      versionType: version.type,
    })

    return {
      instance,
      version,
      versionId,
      javaPath: runtime.path,
      javaMajor: runtime.majorVersion,
      plans,
      classpath: built.classpath,
      nativesDir,
      loggingFile,
      command: built.command,
      mainClass: built.mainClass,
      cwd: instance.path,
      auth: {
        username: account.name,
        uuid: compactUuid(account.uuid),
        accessToken: account.accessToken ?? '0',
        userType: account.kind === 'microsoft' ? 'msa' : 'legacy',
      },
      memory,
      window,
    }
  }

  /** Pick the concrete version id to launch (loaders are separate version files). */
  async resolveVersionId(instance: Instance): Promise<string> {
    const installed = await this.ctx.meta.installed().catch(() => [] as string[])
    const candidates = [...(instance.loaders ?? [])].reverse()
    if (candidates.length === 0) {
      if (installed.includes(instance.gameVersion)) return instance.gameVersion
      return instance.gameVersion
    }
    for (const loader of candidates) {
      const needle = loader.kind.toLowerCase()
      const exact = installed.filter((id) => {
        const lower = id.toLowerCase()
        return lower.includes(needle) && lower.includes(instance.gameVersion.toLowerCase())
      })
      if (exact.length > 0) {
        // Prefer an id that also mentions the exact loader version.
        const pinned = loader.version
          ? exact.find((id) => id.includes(loader.version!))
          : undefined
        return pinned ?? exact[exact.length - 1]
      }
    }
    return instance.gameVersion
  }

  /** Locate the game jar of a version id. */
  versionJarPath(versionId: string, version: RawVersionJson): string | undefined {
    const root = this.ctx.paths.get().versions
    const candidate = join(root, versionId, versionId + '.jar')
    return candidate
  }

  /** Resolve or install a Java runtime able to run the version. */
  private async resolveJava(
    request: LaunchRequest,
    instance: Instance,
    major: number,
    handle?: TaskHandle,
  ): Promise<{ path: string; majorVersion: number }> {
    const preferred = request.javaPath || instance.javaPath || undefined
    if (preferred) {
      const runtime = this.ctx.java.cached().find((item) => item.path === preferred)
        ?? (await this.ctx.java.scan()).find((item) => item.path === preferred)
      if (runtime) return { path: runtime.path, majorVersion: runtime.majorVersion }
      // Trust an explicit path even when the scanner could not parse it.
      return { path: preferred, majorVersion: major }
    }
    const picked = this.ctx.java.pick(major)
    if (picked) return { path: picked.path, majorVersion: picked.majorVersion }
    if (this.ctx.settings.resolved().autoDownloadJava) {
      const component = this.javaComponentOf(major)
      handle?.log('未找到 Java ' + major + '，开始下载 ' + component, 'warn')
      const installed = await this.ctx.java.install(component, handle)
      return { path: installed.path, majorVersion: installed.majorVersion }
    }
    throw new LaunchError('没有可用的 Java ' + major + ' 运行时，请在「Java 运行时」页安装或指定路径')
  }

  /** Mojang runtime component that ships a given major version. */
  javaComponentOf(major: number): string {
    if (major <= 8) return 'jre-legacy'
    if (major <= 11) return 'java-runtime-alpha'
    if (major <= 17) return 'java-runtime-gamma'
    return 'java-runtime-delta'
  }

  /** Download every missing classpath library. */
  private async ensureLibraries(plans: LibraryPlan[], handle?: TaskHandle): Promise<void> {
    const missing = plans.filter((plan) => !!plan.url)
    if (missing.length === 0) return
    let index = 0
    const total = missing.length
    handle?.setProgress({ stage: 'download', current: 0, total, value: 0, message: '检查依赖库' })
    for (const plan of missing) {
      handle?.throwIfCancelled()
      await this.ctx.download.file({
        url: plan.url!,
        destination: plan.path,
        sha1: plan.sha1,
        size: plan.size,
        skipIfExists: true,
      })
      index++
      if (index % 5 === 0 || index === total) {
        handle?.setProgress({ stage: 'download', current: index, total, value: index / total })
      }
    }
  }

  /** Extract every native jar into the instance natives directory. */
  private async extract(plans: LibraryPlan[], nativesDir: string, handle?: TaskHandle): Promise<void> {
    const natives = plans.filter((plan) => plan.native)
    if (natives.length === 0) return
    handle?.setProgress({ stage: 'extract', current: 0, total: natives.length, value: 0, message: '解压原生库' })
    await mkdir(nativesDir, { recursive: true })
    let index = 0
    for (const native of natives) {
      handle?.throwIfCancelled()
      const info = await stat(native.path).catch(() => undefined)
      if (!info?.isFile()) {
        handle?.log('缺少原生库：' + native.name, 'warn')
        continue
      }
      try {
        await extractNatives(native.path, nativesDir, native.exclude)
      } catch (error) {
        handle?.log('解压原生库失败 ' + native.name + ': ' + (error as Error).message, 'warn')
      }
      index++
      handle?.setProgress({ stage: 'extract', current: index, total: natives.length, value: index / natives.length })
    }
  }

  /** Ensure the asset index exists (objects are downloaded by the version installer). */
  private async ensureAssets(version: RawVersionJson, assetsDir: string, handle?: TaskHandle): Promise<void> {
    const assetIndex = version.assetIndex
    if (!assetIndex?.url) return
    const file = join(assetsDir, 'indexes', (assetIndex.id ?? version.assets ?? 'legacy') + '.json')
    const info = await stat(file).catch(() => undefined)
    if (info?.isFile()) return
    handle?.setProgress({ stage: 'download', value: 0, message: '下载资源索引' })
    await this.ctx.download.file({
      url: assetIndex.url,
      destination: file,
      sha1: assetIndex.sha1,
      skipIfExists: true,
    })
  }

  /** Download the log4j configuration referenced by the version json. */
  private async ensureLogging(
    version: RawVersionJson,
    instance: Instance,
    handle?: TaskHandle,
  ): Promise<string | undefined> {
    const logging = version.logging?.client
    if (!logging?.file?.url) return undefined
    const directory = join(instance.path, RHINE_DIR)
    await mkdir(directory, { recursive: true })
    const file = join(directory, 'log4j2.xml')
    const info = await stat(file).catch(() => undefined)
    if (!info?.isFile()) {
      handle?.setProgress({ stage: 'download', value: 0, message: '下载日志配置' })
      await this.ctx.download.file({
        url: logging.file.url,
        destination: file,
        sha1: logging.file.sha1,
        skipIfExists: true,
      })
    }
    return file
  }

  /* ---------------------------------------------------------------- */
  /* spawn / session tracking                                          */
  /* ---------------------------------------------------------------- */

  /** Start the game process and register the session. */
  private async spawn(prepared: PreparedLaunch, request: LaunchRequest, handle?: TaskHandle): Promise<LaunchSession> {
    const session = this.createSession(prepared)
    const logDir = join(prepared.instance.path, RHINE_DIR, 'logs')
    await mkdir(logDir, { recursive: true })
    const logFile = join(logDir, logFileStamp() + '.log')
    session.logFile = logFile
    await this.pruneLogs(logDir)

    handle?.setProgress({ stage: 'write', value: 0.98, message: '启动游戏进程' })
    // Windows batch scripts (and powershell) cannot be CreateProcess'd directly;
    // they need cmd.exe as the shell. Real java.exe keeps shell off.
    const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat|ps1)$/i.test(prepared.javaPath)
    const child = spawn(prepared.javaPath, prepared.command.slice(1), {
      cwd: prepared.cwd,
      detached: request.detach !== false,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
      shell: isWindowsScript ? true : undefined,
      env: { ...process.env },
    })
    this.processes.set(session.id, child)

    const stream = createWriteStream(logFile, { flags: 'a' })
    const write = (line: string) => {
      stream.write(line + '\n')
    }
    write('# ' + new Date().toISOString() + ' ' + prepared.instance.name)
    write('# ' + prepared.command.map(quoteArg).join(' '))

    child.on('spawn', () => {
      session.status = 'running'
      session.pid = child.pid
      this.publish(session)
      handle?.log('游戏已启动（PID ' + child.pid + '）')
      handle?.setProgress({ stage: 'done', value: 1 })
    })

    child.on('error', (error) => {
      const line: LogLine = { time: Date.now(), level: 'error', message: '启动失败：' + error.message }
      this.appendLog(session.id, [line], write)
      session.status = 'crashed'
      session.endedAt = Date.now()
      this.publish(session)
      this.ctx.bus?.emit({ type: 'launch-exit', sessionId: session.id, exitCode: null, status: 'crashed' })
    })

    const feeder = (source: NodeJS.ReadableStream, level: LogLine['level']) => {
      let buffer = ''
      source.setEncoding?.('utf8')
      source.on('data', (chunk: string) => {
        buffer += chunk
        const parts = buffer.split(/\r?\n/)
        buffer = parts.pop() ?? ''
        if (parts.length === 0) return
        const lines: LogLine[] = parts.map((message) => ({
          time: Date.now(),
          level: classifyLine(message, level),
          message,
        }))
        this.appendLog(session.id, lines, write)
      })
      source.on('end', () => {
        if (buffer) this.appendLog(session.id, [{ time: Date.now(), level, message: buffer }], write)
      })
    }
    feeder(child.stdout!, 'info')
    feeder(child.stderr!, 'warn')

    child.on('close', (code, signal) => {
      // 'close' fires after stdio pipes are fully drained, so the log stream
      // is guaranteed to have received every line before we flush it.
      const now = Date.now()
      session.endedAt = now
      session.exitCode = code ?? undefined
      const stopped = session.status === 'stopped'
      session.status = stopped ? 'stopped' : code === 0 ? 'exited' : 'crashed'
      const tail = [{ time: now, level: 'info' as const, message: '进程退出，退出码 ' + code + (signal ? '，信号 ' + signal : '') }]
      this.appendLog(session.id, tail, write)
      new Promise<void>((resolve) => stream.end(() => resolve())).then(() => {
        this.processes.delete(session.id)
        this.persist()
        this.publish(session)
        this.ctx.bus?.emit({ type: 'launch-exit', sessionId: session.id, exitCode: code, status: session.status })
        void this.ctx.instances.addPlayTime(prepared.instance.id, now - session.startedAt).catch(() => {})
      })
    })

    await this.ctx.instances.markLaunched(prepared.instance.id).catch(() => {})
    this.persist()
    this.publish(session)
    if (request.detach !== false) child.unref()
    return session
  }

  private createSession(prepared: PreparedLaunch): LaunchSession {
    const id = 'session-' + (++this.seq) + '-' + Date.now().toString(36)
    const session: LaunchSession = {
      id,
      instanceId: prepared.instance.id,
      accountName: prepared.auth.username,
      startedAt: Date.now(),
      status: 'starting',
      command: prepared.command,
      logFile: '',
    }
    this.sessionsById.set(id, session)
    this.logs.set(id, [])
    this.lastSession.set(prepared.instance.id, session)
    this.publish(session)
    return session
  }

  private lastSession = new Map<string, LaunchSession>()
  private lastSessionOf(instanceId: string): LaunchSession | undefined {
    return this.lastSession.get(instanceId)
  }

  /** Append lines to memory and disk, notifying bus subscribers. */
  private appendLog(sessionId: string, lines: LogLine[], write: (line: string) => void): void {
    if (lines.length === 0) return
    const buffer = this.logs.get(sessionId) ?? []
    buffer.push(...lines)
    if (buffer.length > MAX_LOG_LINES) buffer.splice(0, buffer.length - MAX_LOG_LINES)
    this.logs.set(sessionId, buffer)
    for (const line of lines) write(line.message)
    this.ctx.bus?.emit({ type: 'launch-log', sessionId, lines })
  }

  /** Broadcast a session snapshot. */
  private publish(session: LaunchSession): void {
    this.ctx.bus?.emit({ type: 'launch', session: { ...session } })
  }

  /** Keep only the N newest log files of an instance. */
  private async pruneLogs(directory: string): Promise<void> {
    const keep = this.ctx.settings.resolved().keepLogs ?? 10
    if (keep <= 0) return
    const entries = await readdir(directory).catch(() => [] as string[])
    const files = entries.filter((name) => name.endsWith('.log')).sort()
    const excess = files.slice(0, Math.max(0, files.length - keep))
    await Promise.all(excess.map((name) => unlink(join(directory, name)).catch(() => {})))
  }

  /* ---------------------------------------------------------------- */
  /* persistence                                                       */
  /* ---------------------------------------------------------------- */

  private sessionFile(): string {
    return join(this.ctx.paths.get().root, SESSION_FILE)
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    const stored = this.ctx.storage.readSync<LaunchSession[]>(this.sessionFile(), [])
    for (const session of stored) {
      if (!session?.id) continue
      // Anything still marked running was interrupted by a launcher restart.
      if (session.status === 'running' || session.status === 'starting') {
        session.status = 'stopped'
      }
      this.sessionsById.set(session.id, session)
    }
  }

  private persist(): void {
    const list = [...this.sessionsById.values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .slice(0, 50)
    void this.ctx.storage.write(this.sessionFile(), list).catch(() => {})
  }
}

/** Classify a game log line for the UI. */
export function classifyLine(message: string, fallback: LogLine['level']): LogLine['level'] {
  if (/\b(FATAL|ERROR|SEVERE)\b/.test(message) || /Exception|Caused by:/.test(message)) return 'error'
  if (/\bWARN(?:ING)?\b/.test(message)) return 'warn'
  if (/\bDEBUG\b|\bTRACE\b/.test(message)) return 'debug'
  return fallback
}

/** Quote an argument for logging (display only, never executed). */
export function quoteArg(arg: string): string {
  if (arg === '') return '""'
  return /\s/.test(arg) ? JSON.stringify(arg) : arg
}


/* ------------------------------------------------------------------ */
/* diagnostics                                                         */
/* ------------------------------------------------------------------ */

/**
 * Crash analysis for the newest log of an instance.
 *
 * Registered as the optional `ctx.diagnostics` service (see
 * `RhContext.diagnostics`) so the server can feature-detect it.
 */
export class DiagnosticsService implements DiagnosticsApi {
  static inject = ['paths', 'instances']

  constructor(protected ctx: Context) {
  }

  /**
   * Scan the newest log of an instance and report known crash signatures.
   *
   * Reads the game log produced by the launcher; when none exists it falls
   * back to `logs/latest.log` inside the instance directory.
   */
  async analyze(instanceId: string): Promise<CrashFinding[]> {
    const instance = this.ctx.instances.get(instanceId)
    if (!instance) throw new Error('实例不存在：' + instanceId)
    const rhineLogs = join(instance.path, RHINE_DIR, 'logs')
    const text = (await this.newestLog(rhineLogs))
      ?? (await this.newestLog(join(instance.path, 'logs')))
      ?? (await this.readText(join(instance.path, 'crash-reports')))
    if (!text) {
      return [{ level: 'info', message: '没有找到可分析的日志文件。', hint: '启动一次游戏后会自动生成日志。' }]
    }
    return analyzeCrash(text, null)
  }

  private async newestLog(directory: string): Promise<string | undefined> {
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
    const files = entries.filter((entry) => entry.isFile() && /\.(log|txt)$/i.test(entry.name))
    let best: { name: string; time: number } | undefined
    for (const file of files) {
      const info = await stat(join(directory, file.name)).catch(() => undefined)
      const time = info?.mtimeMs ?? 0
      // Log names are timestamps, so the name breaks mtime ties.
      if (!best || time > best.time || (time === best.time && file.name > best.name)) {
        best = { name: file.name, time }
      }
    }
    if (!best) return undefined
    return this.readText(join(directory, best.name))
  }

  private async readText(path: string): Promise<string | undefined> {
    const info = await stat(path).catch(() => undefined)
    if (!info) return undefined
    if (info.isFile()) return readFile(path, 'utf8').catch(() => undefined)
    if (!info.isDirectory()) return undefined
    const entries = await readdir(path).catch(() => [] as string[])
    const sorted = entries.filter((name) => /\.(log|txt)$/i.test(name)).sort().reverse()
    if (!sorted.length) return undefined
    return readFile(join(path, sorted[0]), 'utf8').catch(() => undefined)
  }
}

