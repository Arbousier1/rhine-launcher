/**
 * Cordis service interfaces for Rhine Launcher.
 *
 * Each core package implements one of these interfaces as a Cordis `Service`
 * registered under the given name, e.g.
 *
 *   export class InstanceService extends Service implements InstancesApi {
 *     constructor(ctx: Context) { super(ctx, 'instances') }
 *   }
 *
 * The HTTP/WS layer only ever talks to these interfaces, never to a concrete
 * implementation, so a service can be swapped by isolating the context.
 */
import type {
  Account, Bootstrap, DeviceCodeFlow, Instance, InstanceConfig, InstanceFile,
  JavaRuntime, LaunchRequest, LaunchSession, LoaderVersion, LogLine, MarketProject,
  MarketSearchResult, MarketVersion, ModFile, ModUpdateInfo, ModpackManifest, Progress,
  ProjectType, RemoteVersion, Settings, TaskSnapshot, LoaderSpec, LoaderKind,
} from './types.ts'
import type { Context } from '@deepseek-ai/cordis'

/** Runtime paths resolved from the configured data root. */
export interface RhPaths {
  root: string
  instances: string
  assets: string
  libraries: string
  versions: string
  java: string
  logs: string
  temp: string
}

export interface PathsApi {
  /** Current resolved paths (settings.dataDir wins over the default root). */
  get(): RhPaths
  /** Absolute path for one instance directory. */
  instance(id: string): string
  /** Ensure the standard directory skeleton exists. */
  ensure(): Promise<void>
  /** Recompute the layout after the data directory changed. */
  reset(root?: string): RhPaths
}

/** Low-level JSON persistence helper (atomic writes). */
export interface StorageApi {
  read<T>(file: string, fallback: T): Promise<T>
  write(file: string, value: unknown): Promise<void>
  readSync<T>(file: string, fallback: T): T
}

export interface SettingsApi {
  get(): Settings
  update(patch: Partial<Settings>): Promise<Settings>
  /** Effective, fully resolved settings (defaults applied). */
  resolved(): Settings
  /** Point the settings file at a new data root (called by paths.reset). */
  relocate(root: string): void
}

/** Client-facing event bus; the WS hub subscribes to it. */
export interface BusApi {
  emit(event: import('./types.ts').ServerEvent): void
  subscribe(listener: (event: import('./types.ts').ServerEvent) => void): () => void
}

export interface TaskApi {
  /** Start a task and return its id; runs in the background. */
  run<T>(title: string, kind: string, body: (task: TaskHandle) => Promise<T>): string
  list(): TaskSnapshot[]
  get(id: string): TaskSnapshot | undefined
  cancel(id: string): boolean
  clear(): void
  /** Await a task's completion (used by tests and blocking API calls). */
  wait(id: string): Promise<TaskSnapshot>
}

export interface TaskHandle {
  id: string
  setProgress(progress: Partial<Progress>): void
  log(message: string, level?: LogLine['level']): void
  readonly cancelled: boolean
  readonly signal?: AbortSignal
  /** Call on long loops; throws TaskCancelled when the user cancelled. */
  throwIfCancelled(): void
}

export interface DownloadApi {
  /** Download one URL to a path, verifying hash when given. Returns bytes written. */
  file(options: DownloadOptions): Promise<number>
  /** Download many files with bounded concurrency and progress reporting. */
  batch(items: DownloadItem[], handle?: TaskHandle, concurrency?: number): Promise<void>
  /** HEAD/GET a small text/binary resource. */
  text(url: string, options?: {signal?:AbortSignal;timeoutMs?:number;retries?:number;maxBytes?:number}): Promise<string>
  buffer(url: string, options?: {signal?:AbortSignal;timeoutMs?:number;retries?:number;maxBytes?:number}): Promise<Uint8Array>
}

export interface DownloadOptions {
  url: string
  /** Absolute destination path. */
  destination: string
  sha1?: string
  sha256?: string
  sha512?: string
  size?: number
  maxBytes?: number
  signal?: AbortSignal
  timeoutMs?: number
  /** Do not re-download when the destination already matches the hash. */
  skipIfExists?: boolean
  retries?: number
  /** Optional fallback mirrors tried when the primary URL fails. */
  mirrors?: string[]
}

export interface DownloadItem extends DownloadOptions {
  /** Optional mirror list tried after the primary url. */
  mirrors?: string[]
}

/** Minecraft game metadata: version manifest + version json chains. */
export interface MetaApi {
  /** Cached (10 min) version manifest. */
  remoteVersions(): Promise<RemoteVersion[]>
  remoteVersion(id: string): Promise<RemoteVersion | undefined>
  /** Download + cache a version json by id (works for installed and remote versions). */
  versionJson(id: string): Promise<RawVersionJson>
  /** Resolve the full inherited chain of a version json (child first). */
  versionChain(id: string): Promise<RawVersionJson[]>
  /** Installed version ids inside the versions directory. */
  installed(): Promise<string[]>
  /** Merged json for launching (inheritsFrom resolved, libraries merged). */
  resolvedJson(id: string): Promise<RawVersionJson>
  /**
   * Install a vanilla version: client jar, libraries, assets and the
   * version json, reporting progress through the task handle.
   */
  install(gameVersion: string, handle?: TaskHandle): Promise<void>
  /** True when versions/<id>/<id>.json and its client jar are both complete. */
  isInstalled(id: string): Promise<boolean>
}

/** Minimal structural view of a Minecraft version json (fields we consume). */
export interface RawVersionJson {
  id: string
  type?: string
  inheritsFrom?: string
  mainClass?: string
  assets?: string
  assetIndex?: { id: string; url: string; sha1?: string; size?: number; totalSize?: number }
  downloads?: Record<string, { url: string; sha1?: string; size?: number }>
  libraries?: RawLibrary[]
  arguments?: { game?: (string | RawArgument)[][]; jvm?: (string | RawArgument)[][] }
  minecraftArguments?: string
  javaVersion?: { component: string; majorVersion: number }
  logging?: { client?: { argument: string; file: { id: string; url: string; sha1?: string; size?: number } } }
  releaseTime?: string
  time?: string
  [key: string]: unknown
}

export interface RawLibrary {
  name: string
  downloads?: { artifact?: { url: string; path: string; sha1?: string; size?: number }; classifiers?: Record<string, { url: string; path: string; sha1?: string; size?: number }> }
  natives?: Record<string, string>
  extract?: { exclude?: string[] }
  rules?: RawRule[]
  url?: string
}

export interface RawArgument {
  rules?: RawRule[]
  value: string | string[]
}

export interface RawRule {
  action: 'allow' | 'disallow'
  os?: { name?: string; arch?: string; version?: string }
  features?: Record<string, boolean>
}

export interface LoaderApi {
  /** Available loader versions for a game version. */
  versions(kind: LoaderKind, gameVersion: string): Promise<LoaderVersion[]>
  /** Run the loader installer and write the merged version json into versions/. */
  install(kind: LoaderKind, gameVersion: string, loaderVersion: string, handle?: TaskHandle): Promise<string>
  /** Detect installed loader attachments for a game version. */
  detect(gameVersion: string): Promise<LoaderSpec[]>
}

export interface JavaApi {
  /** Discover JREs: managed directory, JAVA_HOME, PATH and common install roots. */
  scan(): Promise<JavaRuntime[]>
  cached(): JavaRuntime[]
  /** Pick a runtime able to run the given major version (17/21/...). */
  pick(majorVersion: number, preferred?: string): JavaRuntime | undefined
  /** Download a Mojang JRE for the given component ("java-runtime-gamma"). */
  install(component: string, handle?: TaskHandle): Promise<JavaRuntime>
}

export interface AccountApi {
  list(): Account[]
  get(id: string): Account | undefined
  addOffline(name: string): Promise<Account>
  /** Add an authlib-injector (custom Yggdrasil / LittleSkin) account. */
  addAuthlibInjector(authServerUrl: string, username: string, password: string): Promise<Account>
  remove(id: string): Promise<void>
  /** Start Microsoft OAuth device-code flow. */
  beginMicrosoft(): Promise<DeviceCodeFlow>
  /** Poll until the device-code flow completes. */
  completeMicrosoft(): Promise<Account>
  /** Refresh an expired access token; returns the fresh account. */
  refresh(id: string): Promise<Account>
  /** Ensure the account has a valid access token before launching. */
  authorize(id: string): Promise<Account>
}

export interface InstanceApi {
  list(): Instance[]
  get(id: string): Instance | undefined
  create(config: InstanceConfig): Promise<Instance>
  update(id: string, patch: Partial<InstanceConfig>): Promise<Instance>
  remove(id: string, options?: { deleteFiles?: boolean }): Promise<void>
  duplicate(id: string, name: string): Promise<Instance>
  /** Import a modpack (.mrpack or CurseForge .zip) and create an instance. */
  importModpack(zipPath: string, name?: string, handle?: TaskHandle): Promise<Instance>
  /** List files under the instance dir (relative paths). */
  files(id: string, subdir?: string): Promise<InstanceFile[]>
  /** Read/write a small text config file inside the instance (options.txt etc.). */
  /** Record a successful launch (updates lastLaunchedAt and play time). */
  markLaunched(id: string): Promise<Instance>
  /** Add elapsed play time in milliseconds. */
  addPlayTime(id: string, elapsedMs: number): Promise<void>
  readFile(id: string, relative: string): Promise<string>
  writeFile(id: string, relative: string, content: string): Promise<void>
  deleteFile(id: string, relative: string): Promise<void>
}

export interface ModApi {
  /** Scan mods/ and return parsed descriptors. */
  list(instanceId: string): Promise<ModFile[]>
  setEnabled(instanceId: string, diskName: string, enabled: boolean): Promise<ModFile>
  remove(instanceId: string, diskName: string): Promise<void>
  /** Install a downloaded jar into mods/. */
  install(instanceId: string, url: string, fileName: string, handle?: TaskHandle): Promise<ModFile>
  /** Parse a jar's metadata without installing. */
  inspect(jarPath: string): Promise<import('./types.ts').ModMeta | undefined>
  /** Check if any enabled mods have newer versions available. */
  checkUpdates(instanceId: string): Promise<ModUpdateInfo[]>
}

export interface MarketApi {
  search(query: MarketSearchInput): Promise<MarketSearchResult>
  project(source: 'modrinth' | 'curseforge', id: string): Promise<MarketProject>
  versions(source: 'modrinth' | 'curseforge', projectId: string, filter?: { gameVersion?: string; loader?: string }): Promise<MarketVersion[]>
  /** Install a project version into an instance (mods/, resourcepacks/, shaderpacks/). */
  install(instanceId: string, version: MarketVersion, handle?: TaskHandle): Promise<InstanceFile>
}

export interface MarketSearchInput {
  source: 'modrinth' | 'curseforge'
  query: string
  projectType?: ProjectType
  gameVersion?: string
  loader?: string
  offset?: number
  limit?: number
  sort?: 'relevance' | 'downloads' | 'follows' | 'updated' | 'newest'
}

export interface LaunchApi {
  launch(request: LaunchRequest): Promise<LaunchSession>
  sessions(): LaunchSession[]
  session(id: string): LaunchSession | undefined
  kill(sessionId: string): Promise<void>
  /** Build the argument vector without starting the game (for diagnostics/UI preview). */
  buildCommand(request: LaunchRequest): Promise<{ command: string[]; cwd: string; mainClass: string }>
  /** Recent log lines of a session (tail). */
  log(sessionId: string, tail?: number): LogLine[]
}

export interface DiagnosticsApi {
  /** Scan the newest log of an instance for known crash signatures. */
  analyze(instanceId: string): Promise<{ level: 'info' | 'warn' | 'error'; message: string; hint?: string }[]>
}

/**
 * The services a fully assembled launcher context provides.
 *
 * Kept separate from {@link RhContext} so the Cordis `Context` interface can
 * extend it (see `context.d.ts`) without a circular type alias.
 */
export interface RhServices {
  paths: PathsApi
  storage: StorageApi
  settings: SettingsApi
  bus: BusApi
  tasks: TaskApi
  download: DownloadApi
  meta: MetaApi
  loader: LoaderApi
  java: JavaApi
  accounts: AccountApi
  instances: InstanceApi
  mods: ModApi
  market: MarketApi
  launch: LaunchApi
  diagnostics?: DiagnosticsApi
}

/** Convenience alias for a fully assembled launcher context. */
export type RhContext = Context & RhServices