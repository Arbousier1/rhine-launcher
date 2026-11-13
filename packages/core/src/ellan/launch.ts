import { spawn, type ChildProcess } from 'node:child_process'
import { constants } from 'node:fs'
import { access, mkdir, stat } from 'node:fs/promises'
import { isAbsolute, join, resolve } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import { toOriginalInstance, toOriginalJava, toOriginalUser } from '@rhine/ellan-ui/projections'
import { originalVersionHeader, parseOriginalVersion, type OriginalVersionHeader } from '@rhine/ellan-ui/node-runtime'
import { diagnoseOriginalInstallation, generateOriginalClientArguments, generateOriginalServerArguments,
  matchOriginalInstalledVersion, parseOriginalServerVersion, planOriginalVanillaServer,
  watchOriginalMinecraftProcess, type OriginalInstallIssue } from '@rhine/ellan-ui/diagnostics'
import type { RawVersionJson, RhPaths } from '../contracts.ts'
import type { Account, Instance, JavaRuntime, LaunchRequest, LaunchSession } from '../types.ts'
import type { PreparedFeatureLaunch } from '../runtime/feature-plan.ts'
import { redactCommand } from '../runtime/feature-plan.ts'
import { publicValue } from '../plugins/public-value.ts'
import { javaMajorVersion, parseJavaProbe } from '../java/discovery.ts'
import { requiredJavaMajor } from '../services/launch.ts'
import { identifier } from '../plugins/http-input.ts'
import { type OriginalCall, record, text } from './feature.ts'
import { findInstance } from './reads.ts'
import { emitOriginal, store } from './state.ts'

export interface OriginalLaunchOptions extends Record<string, unknown> {
  version: string; gameDirectory: string; user: Record<string, unknown>; java: string
  side?: 'client' | 'server'; operationId?: string
  minMemory?: number; maxMemory?: number; vmOptions?: string[]; mcOptions?: string[]
  env?: Record<string, string>; resolution?: { width?: number; height?: number; fullscreen?: boolean; monitor?: string }
  server?: { host: string; port?: number }; world?: string; nogui?: boolean
  skipAssetsCheck?: boolean; hideLauncher?: boolean; showLog?: boolean
  launcherName?: string; launcherBrand?: string
  yggdrasilAgent?: { jar: string; server: string; prefetched?: string }
  prependCommand?: string; preExecuteCommand?: string
}
export interface OriginalLaunchRequest extends LaunchRequest { originalOptions: OriginalLaunchOptions }
interface OriginalPreparedLaunch extends PreparedFeatureLaunch { originalHeader?: OriginalVersionHeader }
export interface OriginalGameProcess {
  pid: number; launchId: string; ready: boolean; side: 'client' | 'server'; options: OriginalLaunchOptions
}
interface ProcessEntry { process: OriginalGameProcess; live: boolean; startedAt: number }
interface ProcessRepository { entries: Map<string, ProcessEntry>; pids: Map<number, string> }
function processes(env: FeatureEnvironment): ProcessRepository {
  return env.state<ProcessRepository>('ellan.launch.processes', () => ({ entries: new Map(), pids: new Map() }))
}
function launchException(type: string, message: string, details: Record<string, unknown> = {}) {
  return Object.assign(new FeatureError('ORIGINAL_LAUNCH_FAILED', message, 409), { name: 'LaunchException', exception: { type, ...details } })
}
function installationError(issue: OriginalInstallIssue) {
  return Object.assign(new FeatureError('INSTALLATION_INCOMPLETE', 'Installation failed current-file diagnosis', 409), { name: 'InstallError', issue })
}
function pid(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value <= 0) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Expected a positive numeric process id', 400)
  return value
}
function strings(value: unknown, label: string): string[] | undefined {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.some(v => typeof v !== 'string' || v.includes('\0') || v.length > 32768)) {
    throw new FeatureError('INVALID_ORIGINAL_CALL', 'Expected ' + label + ' string array', 400)
  }
  return [...value]
}
function optionalNumber(value: unknown, label: string, max: number): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0 || value > max) {
    throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid ' + label, 400)
  }
  return value
}
export function originalOptions(value: unknown): OriginalLaunchOptions {
  const source = record(value, 'LaunchOptions')
  const options = structuredClone(source) as OriginalLaunchOptions
  options.version = identifier(source.version, 'version')
  options.gameDirectory = text(source.gameDirectory, 'game directory')
  if (!source.java) throw launchException('launchNoProperJava', 'No Java runtime was selected', { javaPath: '' })
  options.java = text(source.java, 'Java executable')
  if (!isAbsolute(options.gameDirectory) || !isAbsolute(options.java)) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Launch paths must be absolute', 400)
  options.user = record(options.user, 'user profile')
  text(options.user.id, 'user id')
  if (source.side !== undefined && source.side !== 'client' && source.side !== 'server') throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid launch side', 400)
  options.side = source.side as OriginalLaunchOptions['side'] ?? 'client'
  for (const key of ['skipAssetsCheck', 'hideLauncher', 'showLog', 'disableElyByAuthlib', 'nogui']) {
    if (source[key] !== undefined && typeof source[key] !== 'boolean') throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid ' + key + ' flag', 400)
  }
  for (const key of ['operationId', 'world', 'launcherName', 'launcherBrand', 'prependCommand', 'preExecuteCommand']) {
    if (source[key] !== undefined && (typeof source[key] !== 'string' || (source[key] as string).includes('\0'))) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid ' + key, 400)
  }
  if (source.yggdrasilAgent !== undefined) {
    const agent = record(source.yggdrasilAgent, 'authlib agent')
    text(agent.jar, 'authlib jar'); text(agent.server, 'authlib server')
    if (agent.prefetched !== undefined && typeof agent.prefetched !== 'string') throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid prefetched authlib metadata', 400)
  }
  options.vmOptions = strings(source.vmOptions, 'VM options')
  options.mcOptions = strings(source.mcOptions, 'Minecraft options')
  options.minMemory = optionalNumber(source.minMemory, 'minimum memory', 2 ** 31 - 1)
  options.maxMemory = optionalNumber(source.maxMemory, 'maximum memory', 2 ** 31 - 1)
  if (options.minMemory && options.maxMemory && options.minMemory > options.maxMemory) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Minimum memory exceeds maximum memory', 400)
  if (source.env !== undefined) {
    const environment = record(source.env, 'environment')
    if (Object.entries(environment).some(([key, value]) => !key || /[=\0]/.test(key) || typeof value !== 'string' || value.includes('\0'))) {
      throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid process environment', 400)
    }
    options.env = { ...environment } as Record<string, string>
  }
  if (source.resolution !== undefined) {
    const resolution = record(source.resolution, 'resolution')
    optionalNumber(resolution.width, 'width', 65535); optionalNumber(resolution.height, 'height', 65535)
    if (resolution.fullscreen !== undefined && typeof resolution.fullscreen !== 'boolean') throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid fullscreen option', 400)
  }
  if (source.server !== undefined) {
    const server = record(source.server, 'server')
    text(server.host, 'server host'); optionalNumber(server.port, 'server port', 65535)
    if (server.port === 0) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid server port', 400)
  }
  // The core deliberately never launches arbitrary shell commands. Do not
  // silently drop original shell settings, or execute them through shell:true.
  if (source.prependCommand || source.preExecuteCommand) {
    throw new FeatureError('UNSUPPORTED_ORIGINAL_LAUNCH_COMMAND', 'Prepend/pre-execute shell commands are not supported by this host', 501)
  }
  return options
}

/** A bounded real executable probe, parsed by the existing maintained Java parser. */
export async function probeOriginalJava(path: string, signal: AbortSignal): Promise<JavaRuntime> {
  if (/\.(cmd|bat|ps1)$/i.test(path)) throw launchException('launchInvalidJavaPath', 'Java must be a directly executable runtime', { javaPath: path })
  try {
    if (!(await stat(path)).isFile()) throw new Error('Not a file')
    await access(path, constants.X_OK)
  } catch (error) {
    throw launchException((error as NodeJS.ErrnoException).code === 'EACCES' ? 'launchJavaNoPermission' : 'launchInvalidJavaPath', 'Java executable is missing or not runnable', { javaPath: path })
  }
  signal.throwIfAborted()
  const result = await new Promise<{ output: string; code: number | null }>((resolveProbe, reject) => {
    const child = spawn(path, ['-XshowSettings:properties', '-version'], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = '', timedOut = false, overflow = false
    const timer = setTimeout(() => { timedOut = true; child.kill() }, 5000)
    const abort = () => child.kill()
    signal.addEventListener('abort', abort, { once: true })
    const feed = (chunk: Buffer) => { output += chunk.toString(); if (output.length > 256 * 1024) { overflow = true; output = output.slice(0, 256 * 1024); child.kill() } }
    child.stdout?.on('data', feed); child.stderr?.on('data', feed)
    child.once('error', error => { clearTimeout(timer); signal.removeEventListener('abort', abort); reject(error) })
    child.once('close', code => {
      clearTimeout(timer); signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(signal.reason)
      else if (timedOut || overflow) reject(launchException('launchNoProperJava', 'Java probe exceeded its time/output limit', { javaPath: path }))
      else resolveProbe({ output, code })
    })
  })
  const parsed = parseJavaProbe(result.output)
  if (result.code !== 0 || !parsed || !javaMajorVersion(parsed.version)) throw launchException('launchNoProperJava', 'Executable did not report a valid Java runtime', { javaPath: path })
  return { path, ...parsed, majorVersion: javaMajorVersion(parsed.version), managed: false }
}
function getOriginalRequest(input: unknown): OriginalLaunchRequest {
  const request = record(input, 'launch request')
  return { ...request, instanceId: identifier(request.instanceId), accountId: text(request.accountId, 'account id'), originalOptions: originalOptions(request.originalOptions) } as OriginalLaunchRequest
}
export function originalProcessEnvironment(request: LaunchRequest): Record<string, string> | undefined {
  return (request as Partial<OriginalLaunchRequest>).originalOptions?.env
}
function libraryPath(paths: RhPaths, path: string) {
  // The maintained parser resolves Maven paths. Reject any external path
  // rather than allowing a server profile to escape the libraries root.
  if (isAbsolute(path) || path.split(/[\\/]/).some(part => part === '..') || path.includes(':')) throw new FeatureError('INVALID_LIBRARY_PATH', 'Library path escapes the data root', 400)
  return join(paths.libraries, path)
}

/** Called by launch.prepare; compose the real core actions, never spawn here. */
export async function prepareOriginalLaunch(input: unknown, env: FeatureEnvironment, preview: boolean): Promise<PreparedFeatureLaunch> {
  const request = getOriginalRequest(input), options = request.originalOptions
  if (options.side !== 'server' && options.yggdrasilAgent?.server === 'x://dev') throw new FeatureError('LOCAL_AUTHORITY_UNAVAILABLE', 'This host has no original local Yggdrasil server; disable the offline authlib injector', 501)
  const instance = await env.use<Instance | undefined>('instance.get', { id: request.instanceId })
  if (!instance || resolve(instance.path) !== resolve(options.gameDirectory)) throw new FeatureError('INSTANCE_NOT_FOUND', 'Launch directory does not identify the registered instance', 404)
  if (request.accountId !== options.user.id) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Launch account does not match the original user', 400)
  const paths = env.use<RhPaths>('paths.get')
  const installed = await env.use<Promise<string[]>>('version.installed')
  if (!installed.includes(options.version)) throw launchException('launchNoVersionInstalled', 'Requested version is not installed', { options })
  const resolved = await parseOriginalVersion(paths.root, options.version)
  const header = originalVersionHeader(resolved)
  const version = await env.use<Promise<RawVersionJson>>('version.resolve', { id: options.version })
  const account = preview ? await env.use<Account | undefined>('account.get', { id: request.accountId })
    : await env.use<Promise<Account>>('account.authorize', { id: request.accountId })
  if (!account) throw new FeatureError('ACCOUNT_NOT_FOUND', 'Launch account is not registered', 404)
  const java = await probeOriginalJava(options.java, env.signal)
  const required = requiredJavaMajor(version, header.minecraft)
  const compatible = resolved.compatibleJavaMajors
  if (java.majorVersion < required || Array.isArray(compatible) && compatible.length && !compatible.includes(java.majorVersion)) {
    throw launchException('launchNoProperJava', 'Selected Java is incompatible with this version', { javaPath: options.java })
  }
  let command: string[], cwd = instance.path, mainClass = String(resolved.mainClass)
  if (options.side === 'server') {
    const server = await parseOriginalServerVersion(paths.root, options.version)
    mainClass = server.mainClass || '-jar'
    if (!preview) {
      const issue = await diagnoseOriginalInstallation(paths.root, options.version, 'server')
      if (issue) throw installationError(issue)
      cwd = join(instance.path, 'server'); await mkdir(cwd, { recursive: true })
    } else cwd = join(instance.path, 'server')
    command = generateOriginalServerArguments({
      javaPath: options.java, minMemory: options.minMemory, maxMemory: options.maxMemory,
      mainClass: server.mainClass, serverExectuableJarPath: server.jar ? libraryPath(paths, server.jar) : undefined,
      classPath: [...server.libraries.filter(l => !l.isNative).map(l => libraryPath(paths, l.download.path)),
        libraryPath(paths, 'net/minecraft/server/' + server.minecraftVersion + '/server-' + server.minecraftVersion + '-bundled.jar')],
      extraJVMArgs: [...server.arguments.jvm, ...(options.vmOptions ?? [])],
      extraMCArgs: [...server.arguments.game, ...(options.mcOptions ?? [])], nogui: options.nogui,
    })
  } else {
    if (!preview) {
      const before = await diagnoseOriginalInstallation(paths.root, options.version, 'client')
      if (before?.jar) {
        const base = await env.use<Promise<RawVersionJson>>('version.get', { id: header.minecraft })
        await env.use<Promise<void>>('minecraft.client.install', { version: base })
      }
      await env.use<Promise<void>>('minecraft.libraries.install', { version })
      if (!options.skipAssetsCheck) await env.use<Promise<void>>('minecraft.assets.install', { version })
      await env.use<Promise<void>>('minecraft.logging.install', { version })
      await env.use<Promise<void>>('minecraft.natives.extract', { instanceId: instance.id, version })
      const issue = await diagnoseOriginalInstallation(paths.root, options.version, 'client')
      if (options.skipAssetsCheck && issue) { delete issue.assets; delete issue.assetsIndex }
      if (issue && Object.keys(issue).length) throw installationError(issue)
    }
    let agent = options.yggdrasilAgent
    if (agent) {
      const url = new URL(text(agent.server, 'authlib server'))
      if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid authlib authority URL', 400)
      if (account.kind !== 'authlib-injector' || !account.authServerUrl || new URL(account.authServerUrl).href !== url.href) {
        throw new FeatureError('INVALID_ORIGINAL_CALL', 'Authlib agent authority does not match the registered account', 400)
      }
      if (!(await stat(text(agent.jar, 'authlib jar')).catch(() => undefined))?.isFile()) throw new FeatureError('AUTHLIB_AGENT_MISSING', 'The requested authlib agent file is missing', 409)
      agent = { ...agent }
    }
    command = await generateOriginalClientArguments({
      // The core consumes the id-named index, even when the legacy assets alias differs.
      version: { ...resolved, assets: version.assetIndex?.id ?? resolved.assets }, gamePath: instance.path, resourcePath: paths.root, javaPath: options.java,
      nativeRoot: join(instance.path, 'natives'), gameProfile: { id: account.uuid.replace(/-/g, ''), name: account.name },
      accessToken: account.accessToken || '0', userType: account.kind === 'microsoft' ? 'msa' : account.kind === 'authlib-injector' ? 'mojang' : 'legacy',
      minMemory: options.minMemory, maxMemory: options.maxMemory, extraJVMArgs: options.vmOptions,
      extraMCArgs: options.mcOptions, resolution: options.resolution, yggdrasilAgent: agent,
      launcherName: options.launcherName ?? 'Rhine Launcher', launcherBrand: options.launcherBrand ?? 'Rhine Launcher',
      useHashAssetsIndex: false, server: options.server ? { ip: options.server.host, port: options.server.port } : undefined,
      quickPlayMultiplayer: options.server ? options.server.host + (options.server.port ? ':' + options.server.port : '') : undefined,
      quickPlaySingleplayer: options.world,
    })
  }
  env.signal.throwIfAborted()
  return { instance, request, account, version, command, cwd, mainClass, originalHeader: header } as OriginalPreparedLaunch
}
async function requestFromOptions(input: OriginalCall, env: FeatureEnvironment): Promise<OriginalLaunchRequest> {
  const options = originalOptions(input.args[0]), instance = await findInstance(env, options.gameDirectory)
  return { instanceId: instance.id, accountId: text(options.user.id, 'user id'), javaPath: options.java,
    memoryMb: options.maxMemory, extraJvmArgs: options.vmOptions, extraGameArgs: options.mcOptions, originalOptions: options }
}
export async function launch(input: OriginalCall, env: FeatureEnvironment): Promise<number> {
  const request = await requestFromOptions(input, env)
  const session = await env.use<Promise<LaunchSession>>('launch.start', request)
  const process = processes(env).entries.get(session.id)?.process
  if (!process || process.pid !== pid(session.pid)) throw launchException('launchSpawnProcessFailed', 'Core launch did not observe a real process')
  return process.pid
}
export async function generateArguments(input: OriginalCall, env: FeatureEnvironment): Promise<string[]> {
  const plan = await prepareOriginalLaunch(await requestFromOptions(input, env), env, true)
  return redactCommand(plan.command, [plan.account.accessToken ?? '', plan.account.refreshToken ?? '', plan.account.clientToken ?? ''])
}
function emitService(env: FeatureEnvironment, service: string, event: string, payload: unknown) {
  try { emitOriginal(env, 'service-event', [{ service, event, args: [payload] }]) }
  catch (error) { if (!(error instanceof FeatureError) || !['PLUGIN_CANCELLED', 'PLUGIN_UNAVAILABLE'].includes(error.code)) throw error }
}

/** Attach at actual spawn time, before core pipe consumers; never infer ready from running. */
export function observeOriginalProcess(plan: PreparedFeatureLaunch, child: ChildProcess, session: LaunchSession, env: FeatureEnvironment): void {
  const original = (plan.request as Partial<OriginalLaunchRequest>).originalOptions
  const options: OriginalLaunchOptions = publicValue(structuredClone(original ?? {
    version: plan.version.id, gameDirectory: plan.instance.path, java: plan.command[0], user: { ...toOriginalUser(plan.account) }, side: 'client',
    minMemory: plan.instance.memory.minMb, maxMemory: plan.request.memoryMb ?? plan.instance.memory.maxMb,
    vmOptions: [...plan.instance.jvmArgs, ...(plan.request.extraJvmArgs ?? [])],
    mcOptions: [...plan.instance.gameArgs, ...(plan.request.extraGameArgs ?? [])], resolution: plan.instance.window,
  })) as OriginalLaunchOptions
  const repository = processes(env)
  let started = false, stdout = '', stderr = '', crashReport = '', crashReportLocation = ''
  const secrets = [plan.account.accessToken, plan.account.refreshToken, plan.account.clientToken].filter((v): v is string => !!v && v !== '0')
  const scrub = (value: string) => secrets.reduce((result, secret) => result.split(secret).join('<redacted>'), value)
  const process: OriginalGameProcess = { pid: 0, launchId: session.id, ready: false, side: options.side ?? 'client', options }
  const entry: ProcessEntry = { process, live: false, startedAt: session.startedAt }
  repository.entries.set(session.id, entry)
  const watcher = watchOriginalMinecraftProcess(child)
  child.once('spawn', () => {
    process.pid = pid(child.pid); started = true; entry.live = true; repository.pids.set(process.pid, session.id)
    const header = (plan as OriginalPreparedLaunch).originalHeader
    emitService(env, 'LaunchService', 'minecraft-start', { ...options, pid: process.pid, launchId: session.id,
      minecraft: header?.minecraft ?? plan.instance.gameVersion, forge: header?.forge ?? '', fabricLoader: header?.fabric ?? '', startTime: session.startedAt })
  })
  watcher.on('error', (error: Error) => emitService(env, 'LaunchService', 'error', { name: error.name, message: scrub(error.message) }))
  watcher.on('minecraft-window-ready', () => {
    if (!started || !entry.live || process.ready) return
    process.ready = true; stdout = ''
    emitService(env, 'LaunchService', 'minecraft-window-ready', { pid: process.pid, launchId: session.id })
  })
  watcher.on('minecraft-exit', (result: { crashReport?: string; crashReportLocation?: string }) => {
    crashReport = result.crashReport ?? ''; crashReportLocation = result.crashReportLocation ?? ''
  })
  const feed = (stream: NodeJS.ReadableStream | null, kind: 'stdout' | 'stderr') => {
    const decoder = new StringDecoder('utf8')
    const append = (value: string) => {
      if (!started || !value) return
      value = scrub(value)
      if (kind === 'stderr') stderr = (stderr + value).slice(-4 * 1024 * 1024)
      else if (!process.ready) stdout = (stdout + value).slice(-4 * 1024 * 1024)
      emitService(env, 'LaunchService', 'minecraft-' + kind, { pid: process.pid, [kind]: value })
    }
    stream?.on('data', (chunk: Buffer | string) => append(typeof chunk === 'string' ? chunk : decoder.write(chunk)))
    stream?.on('end', () => append(decoder.end()))
  }
  feed(child.stdout, 'stdout'); feed(child.stderr, 'stderr')
  child.once('close', (code, signal) => {
    entry.live = false; repository.pids.delete(process.pid)
    if (started) emitService(env, 'LaunchService', 'minecraft-exit', { ...options, pid: process.pid, launchId: session.id,
      code: code ?? undefined, signal: signal ?? undefined, duration: Math.max(0, Date.now() - session.startedAt),
      crashReport: scrub(crashReport) || undefined, crashReportLocation: crashReportLocation || undefined, errorLog: stderr, stdLog: stdout })
    for (const [id, old] of repository.entries) {
      if (repository.entries.size <= 100) break
      if (!old.live) repository.entries.delete(id)
    }
  })
}
export async function gameProcesses(_input: OriginalCall, env: FeatureEnvironment): Promise<OriginalGameProcess[]> {
  const sessions = await env.use<Promise<LaunchSession[]>>('session.list')
  const live = new Set(sessions.filter(s => s.status === 'running' || s.status === 'starting').map(s => s.id))
  return [...processes(env).entries.values()].filter(e => e.live && live.has(e.process.launchId)).map(e => structuredClone(e.process))
}
export async function gameProcess(input: OriginalCall, env: FeatureEnvironment): Promise<OriginalGameProcess | undefined> {
  const repository = processes(env), id = repository.pids.get(pid(input.args[0])), entry = id ? repository.entries.get(id) : undefined
  if (!entry?.live) return undefined
  const session = await env.use<LaunchSession | undefined>('session.get', { id })
  if (!session || session.status !== 'running' && session.status !== 'starting') return undefined
  return structuredClone(entry.process)
}
export async function kill(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const repository = processes(env), id = repository.pids.get(pid(input.args[0]))
  if (input.args[1] !== undefined && typeof input.args[1] !== 'boolean') throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid force flag', 400)
  if (!id || !repository.entries.get(id)?.live) return
  await env.use<Promise<void>>('session.stop', { id, force: input.args[1] })
}

const LOADERS = [['forge', 'forge'], ['neoForged', 'neoforge'], ['fabricLoader', 'fabric'], ['quiltLoader', 'quilt'], ['optifine', 'optifine']] as const
function runtimeLoaders(runtime: Record<string, unknown>) {
  return LOADERS.filter(([key]) => !!runtime[key]).map(([key, kind]) => ({ kind, version: identifier(runtime[key], key) }))
}
async function headers(env: FeatureEnvironment): Promise<OriginalVersionHeader[]> {
  const directory = env.use<RhPaths>('paths.get').root, result: OriginalVersionHeader[] = []
  for (const id of await env.use<Promise<string[]>>('version.installed')) {
    try { result.push(originalVersionHeader(await parseOriginalVersion(directory, id))) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'EACCES') throw error /* Broken metadata is never a healthy local version. */ }
  }
  return result
}
async function refreshVersions(env: FeatureEnvironment) {
  const state = store(env).states.get('VersionState')
  if (!state) return
  const local = await headers(env)
  state.snapshot.local = local
  emitOriginal(env, 'commit', [state.id, 'localVersions', local])
}
interface InstallTiming { task: string; type: 'files' | 'java' | 'materialize'; startedAt: number; duration: number }
async function measured<T>(env: FeatureEnvironment, timings: InstallTiming[], feature: string, input: unknown): Promise<T> {
  env.signal.throwIfAborted(); env.task?.throwIfCancelled()
  const startedAt = Date.now()
  const result = await env.use<Promise<T>>(feature, input)
  timings.push({ task: feature, type: feature === 'java.install' ? 'java' : feature === 'storage.write' ? 'materialize' : 'files', startedAt, duration: Date.now() - startedAt })
  return result
}
async function repairClient(id: string, env: FeatureEnvironment, timings: InstallTiming[], issue: OriginalInstallIssue, reinstall = false): Promise<string> {
  const paths = env.use<RhPaths>('paths.get'), resolved = await parseOriginalVersion(paths.root, id), header = originalVersionHeader(resolved)
  const version = await env.use<Promise<RawVersionJson>>('version.resolve', { id })
  if (issue.jar || reinstall) {
    const base = await env.use<Promise<RawVersionJson>>('version.get', { id: header.minecraft })
    await measured(env, timings, 'minecraft.client.install', { version: base })
  }
  if (issue.libraries || reinstall) await measured(env, timings, 'minecraft.libraries.install', { version })
  if (issue.assets || issue.assetsIndex || reinstall) await measured(env, timings, 'minecraft.assets.install', { version })
  await measured(env, timings, 'minecraft.logging.install', { version })
  if (issue.profile || issue.forge || issue.optifine) {
    const runtime = { forge: header.forge, neoForged: header.neoForged, fabricLoader: header.fabric, quiltLoader: header.quilt, optifine: header.optifine }
    const loaders = runtimeLoaders(runtime)
    if (loaders.length !== 1) throw new FeatureError('UNSUPPORTED_PROFILE_REPAIR', 'This host cannot reconstruct the installed combined/custom loader profile', 501)
    id = await measured(env, timings, 'loader.' + loaders[0].kind + '.install', { gameVersion: header.minecraft, loaderVersion: loaders[0].version })
  }
  const remaining = await diagnoseOriginalInstallation(paths.root, id, 'client')
  if (remaining) throw installationError(remaining)
  return id
}
async function installServer(runtime: Record<string, unknown>, env: FeatureEnvironment, timings: InstallTiming[]): Promise<string> {
  if (runtimeLoaders(runtime).length || runtime.labyMod) throw new FeatureError('UNSUPPORTED_SERVER_LOADER', 'Core loader installers currently install client profiles, not server profiles', 501)
  const id = identifier(runtime.minecraft, 'Minecraft version'), paths = env.use<RhPaths>('paths.get')
  const version = await env.use<Promise<RawVersionJson>>('version.get', { id })
  await measured(env, timings, 'storage.write', { file: join(paths.versions, id, id + '.json'), value: version })
  const plan = await planOriginalVanillaServer(paths.root, id)
  if (plan.file.checksum.algorithm !== 'sha1') throw new FeatureError('UNSUPPORTED_CHECKSUM', 'Unexpected server checksum algorithm', 500)
  await measured(env, timings, 'download.file', { url: plan.file.urls[0], mirrors: plan.file.urls.slice(1), destination: plan.file.path,
    sha1: plan.file.checksum.value, size: plan.file.size, skipIfExists: true })
  for (const operation of plan.operations) {
    if (operation.type !== 'write' || !operation.content) throw new FeatureError('UNSUPPORTED_SERVER_PLAN', 'Unexpected maintained server materialization operation', 500)
    await measured(env, timings, 'storage.write', { file: operation.path, value: JSON.parse(operation.content) })
  }
  const issue = await diagnoseOriginalInstallation(paths.root, id, 'server')
  if (issue) throw installationError(issue)
  await refreshVersions(env)
  return id
}
export async function diagnose(input: OriginalCall, env: FeatureEnvironment): Promise<OriginalInstallIssue | undefined> {
  const options = record(input.args[0], 'diagnosis options'), id = identifier(options.version, 'version')
  if (options.side !== 'client' && options.side !== 'server') throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid diagnosis side', 400)
  return diagnoseOriginalInstallation(env.use<RhPaths>('paths.get').root, id, options.side)
}
export async function installInstance(input: OriginalCall, env: FeatureEnvironment) {
  const request = record(input.args[0], 'instance install request')
  if (request.type !== 'instance') throw new FeatureError('INVALID_ORIGINAL_CALL', 'installInstance only accepts an instance request', 400)
  return install(input, env)
}
export async function install(input: OriginalCall, env: FeatureEnvironment): Promise<unknown> {
  const request = record(input.args[0], 'version install request'), timings: InstallTiming[] = [], startedAt = Date.now()
  if (request.type === 'java') {
    if (request.forceZulu) throw new FeatureError('JAVA_PROVIDER_UNAVAILABLE', 'No Zulu provider is configured in this core', 501)
    const target = record(request.target, 'Java target'), component = identifier(target.component, 'Java component')
    const major = optionalNumber(target.majorVersion, 'Java major version', 1000)
    const installed = await measured<JavaRuntime>(env, timings, 'java.install', { component })
    const java = await probeOriginalJava(installed.path, env.signal)
    if (major && java.majorVersion < major) throw launchException('launchNoProperJava', 'Installed Java does not satisfy the requested major version', { javaPath: installed.path })
    return toOriginalJava({ ...installed, ...java, managed: installed.managed }, true)
  }
  if (request.type === 'server') {
    // Validate the registered instance path even though server artifacts live
    // in the shared data root, not in an arbitrary caller-selected directory.
    await findInstance(env, request.path)
    return installServer(record(request.runtime, 'runtime'), env, timings)
  }
  if (request.type === 'repair' || request.type === 'reinstall') {
    const id = identifier(request.version, 'version'), side = request.side ?? 'client'
    if (side !== 'client' && side !== 'server') throw new FeatureError('INVALID_ORIGINAL_CALL', 'Invalid install side', 400)
    const paths = env.use<RhPaths>('paths.get')
    if (side === 'server') {
      const server = await parseOriginalServerVersion(paths.root, id)
      if (server.minecraftVersion !== id) throw new FeatureError('UNSUPPORTED_SERVER_LOADER', 'Core cannot repair a loader server profile', 501)
      await installServer({ minecraft: server.minecraftVersion }, env, timings)
    } else {
      const issue = await diagnoseOriginalInstallation(paths.root, id, 'client')
      if (issue || request.type === 'reinstall') await repairClient(id, env, timings, issue ?? {}, request.type === 'reinstall')
      await refreshVersions(env)
    }
    return undefined
  }
  if (request.type === 'optifine-mod') throw new FeatureError('OPTIFINE_MOD_INSTALL_UNAVAILABLE', 'Core OptiFine installs a client profile; it cannot masquerade as the original mod-only installer', 501)
  if (request.type !== 'instance') throw new FeatureError('INVALID_ORIGINAL_CALL', 'Unknown original installation request type', 400)
  const instance = await findInstance(env, request.instancePath)
  const runtime = { ...toOriginalInstance(instance).runtime, ...record(request.runtime, 'runtime') }
  const selected = request.selectedVersion ? identifier(request.selectedVersion, 'selected version') : ''
  const paths = env.use<RhPaths>('paths.get')
  let matched = matchOriginalInstalledVersion(await headers(env), selected, runtime)
  let id: string
  if (matched) {
    id = matched.id
    const issue = await diagnoseOriginalInstallation(paths.root, id, 'client')
    if (issue) id = await repairClient(id, env, timings, issue)
  } else {
    if (runtime.labyMod) throw new FeatureError('LABYMOD_INSTALL_UNAVAILABLE', 'No LabyMod installer is configured in this core', 501)
    const loaders = runtimeLoaders(runtime)
    if (loaders.length > 1) throw new FeatureError('UNSUPPORTED_LOADER_COMBINATION', 'Core cannot synthesize a combined loader profile', 501)
    id = identifier(runtime.minecraft, 'Minecraft version')
    if (!await env.use<Promise<boolean>>('version.verify', { id })) await measured(env, timings, 'version.install', { gameVersion: id })
    if (loaders.length) id = await measured(env, timings, 'loader.' + loaders[0].kind + '.install', { gameVersion: id, loaderVersion: loaders[0].version })
    matched = originalVersionHeader(await parseOriginalVersion(paths.root, id))
    const issue = await diagnoseOriginalInstallation(paths.root, id, 'client')
    if (issue) id = await repairClient(id, env, timings, issue)
  }
  const timestamp = Date.now()
  await measured(env, timings, 'storage.write', { file: join(paths.versions, id, '.install-lock'), value: { schemaVersion: 1, version: id, timestamp } })
  await refreshVersions(env)
  return { version: id, timestamp, duration: Date.now() - startedAt, timings }
}
export async function refreshUser(input: OriginalCall, env: FeatureEnvironment) {
  const id = text(input.args[0], 'user id')
  if (input.args[1] !== undefined) record(input.args[1], 'refresh options')
  const account = await env.use<Promise<Account>>('account.refresh', { id }), user = toOriginalUser(account)
  const state = store(env).states.get('UserState')
  if (state) {
    const users = record(state.snapshot.users, 'users'); users[user.id] = user
    emitOriginal(env, 'commit', [state.id, 'userProfile', user])
  }
  emitService(env, 'UserService', 'user-refresh-success', user)
  return user
}
export function prepareAuthlibAgent(_input: OriginalCall, env: FeatureEnvironment): Promise<string> {
  return env.use<Promise<string>>('auth.agent.prepare')
}
