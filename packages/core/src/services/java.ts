import type { Context } from '@deepseek-ai/cordis'
import { spawn } from 'node:child_process'
import { chmod, mkdir, readdir, readFile, stat, symlink } from 'node:fs/promises'
import { join } from 'node:path'
import type { JavaApi, TaskHandle } from '../contracts.ts'
import type { JavaRuntime } from '../types.ts'
import {
  commonJavaRoots, commonJavaScanRoots, dedupeJavaRuntimes, javaExecutableIn, javaExecutableName,
  javaMajorVersion, javaPathKey, looksLikeJavaDirectory,
  normalizeJavaArch, parseJavaProbe, pathEntries, pickJavaRuntime, sortJavaRuntimes,
  type JavaCandidate,
} from '../java/discovery.ts'
import {
  buildJavaFilePlan, javaComponentDirectory, MOJANG_JAVA_CATALOG_URL, mojangPlatformKey,
  runtimeExecutablePath, selectJavaRuntimeEntry,
  type MojangJavaCatalog, type MojangJavaLink, type MojangJavaManifest,
} from '../java/mojang.ts'

/** How long a single 'java -version' probe may take before it is killed. */
export const JAVA_PROBE_TIMEOUT_MS = 15_000

/** Upper bound of probe output kept in memory (property dumps are ~2 KB). */
export const MAX_PROBE_OUTPUT = 256 * 1024

/** How many JVMs are probed at the same time. */
export const JAVA_PROBE_CONCURRENCY = 4

/** How deep the managed-runtime walk descends below '<root>/java'. */
export const JAVA_SCAN_DEPTH = 4

/** File inside '<root>/java' that caches the last scan so bootstrap is warm. */
export const JAVA_CACHE_FILE = 'runtimes.json'

/** Raised when the launcher cannot install or use a Java runtime. */
export class JavaError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'JavaError'
  }
}

/**
 * Java runtime discovery, selection and automatic installation.
 *
 * The scanner mirrors HMCL's 'JavaManager': it looks at the launcher's own
 * '<root>/java' directory first, then JAVA_HOME, PATH and the usual vendor
 * install roots, probes every unique executable once and caches the result so
 * the launcher can start the game without rescanning.
 */
export class JavaService implements JavaApi {
  static inject = ['paths', 'download', 'storage']

  private cache: JavaRuntime[] = []
  private loaded = false
  private inflight: Promise<JavaRuntime[]> | undefined

  constructor(protected ctx: Context) {
  }

  /** Discover runtimes on disk. Concurrent callers share one scan. */
  async scan(): Promise<JavaRuntime[]> {
    if (this.inflight) return this.inflight
    const task = this.runScan()
    this.inflight = task
    try {
      return await task
    } finally {
      if (this.inflight === task) this.inflight = undefined
    }
  }

  /** Last scan result (loaded from disk on first use). */
  cached(): JavaRuntime[] {
    this.ensureLoaded()
    return this.cache.map((runtime) => ({ ...runtime }))
  }

  /** Pick a runtime able to run the requested major version. */
  pick(majorVersion: number, preferred?: string): JavaRuntime | undefined {
    this.ensureLoaded()
    const runtime = pickJavaRuntime(this.cache, majorVersion, preferred)
    return runtime ? { ...runtime } : undefined
  }

  /**
   * Install a Mojang-provided JRE component ('java-runtime-gamma', 'jre-legacy').
   *
   * Downloads the component manifest and every file it lists into
   * '<root>/java/<component>', then probes the fresh executable so the returned
   * record is usable for launching immediately.
   */
  async install(component: string, handle?: TaskHandle): Promise<JavaRuntime> {
    const name = (component ?? '').trim()
    if (!name) throw new JavaError('Java 运行时组件名不能为空')
    const paths = this.ctx.paths.get()
    const platformKey = mojangPlatformKey()

    handle?.setProgress({ stage: 'resolve', value: 0, current: 0, total: 0, message: '获取 Java 运行时清单' })
    let catalog: MojangJavaCatalog
    try {
      const text = await this.ctx.download.text(MOJANG_JAVA_CATALOG_URL)
      catalog = JSON.parse(text) as MojangJavaCatalog
    } catch (error) {
      throw new JavaError('无法获取 Mojang Java 运行时清单，请检查网络连接（' + errorText(error) + '）')
    }

    const entry = selectJavaRuntimeEntry(catalog, name, platformKey)
    if (!entry) {
      throw new JavaError('Mojang 没有为 ' + platformKey + ' 提供运行时 ' + name + '，请手动安装 Java 并在实例中指定路径')
    }

    handle?.throwIfCancelled()
    const manifestPath = join(paths.temp, 'java-' + name + '-' + platformKey + '.json')
    handle?.setProgress({ stage: 'download', value: 0.02, current: 0, total: 1, message: '下载运行时文件清单' })
    try {
      await this.ctx.download.file({
        url: entry.manifest.url,
        destination: manifestPath,
        sha1: entry.manifest.sha1,
        size: entry.manifest.size,
        skipIfExists: true,
      })
    } catch (error) {
      throw new JavaError('下载 Java 运行时文件清单失败（' + errorText(error) + '）')
    }

    let manifest: MojangJavaManifest
    try {
      manifest = JSON.parse(await readFile(manifestPath, 'utf8')) as MojangJavaManifest
    } catch (error) {
      throw new JavaError('Java 运行时文件清单解析失败（' + errorText(error) + '）')
    }

    const target = javaComponentDirectory(paths.java, name)
    const plan = buildJavaFilePlan(manifest, target)
    if (plan.files.length === 0) throw new JavaError('Java 运行时文件清单为空，无法安装 ' + name)

    await mkdir(target, { recursive: true })
    for (const directory of plan.directories) {
      await mkdir(directory, { recursive: true })
    }

    handle?.log('开始安装 Java ' + name + '（' + entry.version.name + '，共 ' + plan.files.length + ' 个文件）')
    handle?.setProgress({
      stage: 'download',
      value: 0.05,
      current: 0,
      total: plan.files.length,
      message: '下载 Java 运行时',
    })
    try {
      await this.ctx.download.batch(plan.files, handle)
    } catch (error) {
      throw new JavaError('下载 Java 运行时失败（' + errorText(error) + '）')
    }

    await this.createLinks(plan.links)
    await this.markExecutables(plan.executables)

    // The batch downloader tolerates a few transient failures; a JRE cannot.
    const missing: string[] = []
    for (const file of plan.files) {
      if (!(await isFile(file.destination))) missing.push(file.destination)
    }
    if (missing.length > 0) {
      throw new JavaError('Java 运行时安装不完整：缺少 ' + missing.length + ' 个文件（例如 '
        + missing[0] + '），请重试')
    }

    const executable = runtimeExecutablePath(target)
    if (!(await isFile(executable))) {
      throw new JavaError('Java 运行时安装不完整：缺少 ' + executable + '，请重试或更换下载源')
    }

    handle?.setProgress({
      stage: 'verify',
      value: 0.95,
      current: plan.files.length,
      total: plan.files.length,
      message: '校验 Java 运行时',
    })
    const probed = await this.probeExecutable({ path: executable, managed: true, source: 'managed' })
    if (!probed) handle?.log('下载的 Java 无法执行，启动时可能需要手动指定运行时', 'warn')
    const runtime: JavaRuntime = probed ?? {
      path: executable,
      version: entry.version.name,
      majorVersion: javaMajorVersion(entry.version.name),
      vendor: 'Mojang',
      arch: normalizeJavaArch(platformKey.endsWith('arm64') ? 'aarch64' : 'amd64'),
      managed: true,
    }
    await this.remember(runtime)
    handle?.setProgress({
      stage: 'done',
      value: 1,
      current: plan.files.length,
      total: plan.files.length,
      message: 'Java 运行时安装完成',
    })
    this.ctx.logger('java').info('已安装 Java %s（%s）', name, runtime.version)
    return { ...runtime }
  }

  /* ---------------------------------------------------------------- */
  /* scanning                                                          */
  /* ---------------------------------------------------------------- */

  private async runScan(): Promise<JavaRuntime[]> {
    const paths = this.ctx.paths.get()
    const candidates: JavaCandidate[] = []
    await this.addManagedCandidates(paths.java, candidates)
    await this.addEnvironmentCandidates(candidates)
    await this.addCommonCandidates(candidates)

    const unique = dedupeCandidates(candidates)
    const probed: JavaRuntime[] = []
    let index = 0
    const worker = async (): Promise<void> => {
      while (true) {
        const current = index++
        if (current >= unique.length) return
        const runtime = await this.probeExecutable(unique[current])
        if (runtime) probed.push(runtime)
      }
    }
    await Promise.all(
      Array.from({ length: Math.min(JAVA_PROBE_CONCURRENCY, unique.length) }, worker),
    )

    this.cache = sortJavaRuntimes(dedupeJavaRuntimes(probed))
    this.loaded = true
    await this.persist()
    this.ctx.logger('java').info('Java 扫描完成：发现 %d 个运行时', this.cache.length)
    return this.cached()
  }

  /** '<root>/java/<runtime>/bin/java(.exe)' — runtimes the launcher downloaded itself. */
  private async addManagedCandidates(root: string, found: JavaCandidate[]): Promise<void> {
    const executable = javaExecutableName()
    const walk = async (directory: string, depth: number): Promise<void> => {
      if (depth > JAVA_SCAN_DEPTH) return
      const direct = join(directory, 'bin', executable)
      if (await isFile(direct)) {
        found.push({ path: direct, managed: true, source: 'managed' })
        return
      }
      for (const entry of await readdirSafe(directory)) {
        const child = join(directory, entry)
        if (await isDirectory(child)) await walk(child, depth + 1)
      }
    }
    await walk(root, 0)
  }

  /** JAVA_HOME and every PATH entry. */
  private async addEnvironmentCandidates(found: JavaCandidate[]): Promise<void> {
    const executable = javaExecutableName()
    const home = process.env.JAVA_HOME?.trim()
    if (home) {
      const candidate = javaExecutableIn(home)
      if (await isFile(candidate)) found.push({ path: candidate, managed: false, source: 'java_home' })
    }
    for (const directory of pathEntries(process.env.PATH)) {
      const candidate = join(directory, executable)
      if (await isFile(candidate)) found.push({ path: candidate, managed: false, source: 'path' })
    }
  }

  /** Vendor install roots and JDK folders unpacked at a drive root. */
  private async addCommonCandidates(found: JavaCandidate[]): Promise<void> {
    const executable = javaExecutableName()
    for (const root of commonJavaRoots()) {
      if (!(await isDirectory(root))) continue
      // Some roots are themselves a JRE (Android Studio's bundled 'jbr').
      const direct = join(root, 'bin', executable)
      if (await isFile(direct)) found.push({ path: direct, managed: false, source: 'common' })
      for (const entry of await readdirSafe(root)) {
        const home = join(root, entry)
        if (!(await isDirectory(home))) continue
        const candidate = join(home, 'bin', executable)
        if (await isFile(candidate)) {
          found.push({ path: candidate, managed: false, source: 'common' })
          continue
        }
        // JetBrains IDEs keep the runtime in '<product>/jbr/bin'.
        const nested = join(home, 'jbr', 'bin', executable)
        if (await isFile(nested)) found.push({ path: nested, managed: false, source: 'common' })
      }
    }

    for (const drive of commonJavaScanRoots()) {
      for (const entry of await readdirSafe(drive)) {
        if (!looksLikeJavaDirectory(entry)) continue
        const home = join(drive, entry)
        if (!(await isDirectory(home))) continue
        const candidate = join(home, 'bin', executable)
        if (await isFile(candidate)) {
          found.push({ path: candidate, managed: false, source: 'common' })
          continue
        }
        for (const nestedEntry of await readdirSafe(home)) {
          const nested = join(home, nestedEntry, 'bin', executable)
          if (await isFile(nested)) found.push({ path: nested, managed: false, source: 'common' })
        }
      }
    }
  }

  /**
   * Probe one executable.
   *
   * Protected so tests can feed recorded property dumps instead of spawning
   * a real JVM.
   */
  protected async probeExecutable(candidate: JavaCandidate): Promise<JavaRuntime | undefined> {
    let parsed = parseJavaProbe(await this.runJava(candidate.path, ['-XshowSettings:properties', '-version']))
    if (!parsed) parsed = parseJavaProbe(await this.runJava(candidate.path, ['-version']))
    if (!parsed) return undefined
    const majorVersion = javaMajorVersion(parsed.version)
    if (!majorVersion) return undefined
    return {
      path: candidate.path,
      version: parsed.version,
      majorVersion,
      vendor: parsed.vendor,
      arch: parsed.arch,
      managed: candidate.managed,
    }
  }

  /** Run java and return its combined stdout + stderr (never rejects). */
  private runJava(executable: string, args: string[]): Promise<string> {
    return new Promise((resolve) => {
      let output = ''
      let settled = false
      let timer: NodeJS.Timeout | undefined
      let child: ReturnType<typeof spawn> | undefined
      const finish = (): void => {
        if (settled) return
        settled = true
        if (timer) clearTimeout(timer)
        resolve(output)
      }
      try {
        child = spawn(executable, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
      } catch {
        finish()
        return
      }
      const append = (chunk: Buffer | string): void => {
        if (output.length >= MAX_PROBE_OUTPUT) return
        output += chunk.toString()
      }
      child.stdout?.on('data', append)
      child.stderr?.on('data', append)
      child.on('error', finish)
      child.on('close', finish)
      timer = setTimeout(() => {
        try {
          child?.kill()
        } catch {
          // The process may have exited between the check and the kill.
        }
        finish()
      }, JAVA_PROBE_TIMEOUT_MS)
    })
  }

  /* ---------------------------------------------------------------- */
  /* cache / install helpers                                           */
  /* ---------------------------------------------------------------- */

  private cacheFile(): string {
    return join(this.ctx.paths.get().java, JAVA_CACHE_FILE)
  }

  private ensureLoaded(): void {
    if (this.loaded) return
    this.loaded = true
    try {
      const stored = this.ctx.storage.readSync<JavaRuntime[]>(this.cacheFile(), [])
      if (Array.isArray(stored)) {
        this.cache = sortJavaRuntimes(stored.filter(isJavaRuntime))
      }
    } catch {
      // A missing cache/paths service simply means 'nothing known yet'.
    }
  }

  private async persist(): Promise<void> {
    try {
      await this.ctx.storage.write(this.cacheFile(), this.cache)
    } catch (error) {
      this.ctx.logger('java').debug('保存 Java 扫描缓存失败: %s', errorText(error))
    }
  }

  private async remember(runtime: JavaRuntime): Promise<void> {
    this.ensureLoaded()
    const key = javaPathKey(runtime.path)
    const others = this.cache.filter((item) => javaPathKey(item.path) !== key)
    this.cache = sortJavaRuntimes(dedupeJavaRuntimes([runtime, ...others]))
    await this.persist()
  }

  private async createLinks(links: MojangJavaLink[]): Promise<void> {
    for (const link of links) {
      try {
        await symlink(link.target, link.path)
      } catch (error) {
        this.ctx.logger('java').debug('创建 Java 运行时链接失败 %s: %s', link.path, errorText(error))
      }
    }
  }

  private async markExecutables(files: string[]): Promise<void> {
    if (process.platform === 'win32') return
    for (const file of files) {
      await chmod(file, 0o755).catch(() => undefined)
    }
  }
}

/** Remove duplicate candidates before spawning probes. */
function dedupeCandidates(candidates: JavaCandidate[]): JavaCandidate[] {
  const seen = new Set<string>()
  const out: JavaCandidate[] = []
  for (const candidate of candidates) {
    if (!candidate?.path) continue
    const key = javaPathKey(candidate.path)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(candidate)
  }
  return out
}

function isJavaRuntime(value: unknown): value is JavaRuntime {
  if (!value || typeof value !== 'object') return false
  const runtime = value as Partial<JavaRuntime>
  return typeof runtime.path === 'string' && runtime.path.length > 0 && typeof runtime.version === 'string'
}

async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory()
  } catch {
    return false
  }
}

async function readdirSafe(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

