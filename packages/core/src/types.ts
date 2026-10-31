/**
 * Shared type contract for Rhine Launcher.
 *
 * Every package (core / server / web) compiles against this file, so treat it as
 * the single source of truth for wire formats. Runtime-free: types only.
 */

/* ------------------------------------------------------------------ */
/* primitives                                                          */
/* ------------------------------------------------------------------ */

export type LoaderKind = 'vanilla' | 'fabric' | 'quilt' | 'forge' | 'neoforge' | 'optifine' | 'liteloader'

export type TaskStatus = 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'

export type ProgressStage =
  | 'resolve'
  | 'download'
  | 'verify'
  | 'extract'
  | 'write'
  | 'done'

export interface Progress {
  /** 0..1, or -1 when the total is unknown. */
  value: number
  /** Human readable label of the current step. */
  stage: ProgressStage
  current: number
  total: number
  message?: string
}

export interface TaskSnapshot {
  id: string
  kind: string
  title: string
  status: TaskStatus
  progress: Progress
  logs: LogLine[]
  /** Set when status is failed. */
  error?: string
  createdAt: number
  finishedAt?: number
}

export interface LogLine {
  time: number
  level: 'debug' | 'info' | 'warn' | 'error'
  message: string
}

/* ------------------------------------------------------------------ */
/* versions                                                            */
/* ------------------------------------------------------------------ */

export interface RemoteVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  url: string
  releaseTime: string
  sha1?: string
  /** Stable display label, e.g. "1.21.4". */
  name: string
}

export interface LoaderVersion {
  /** Version string understood by the loader installer, e.g. "0.16.9" or "20.4.237". */
  version: string
  type: 'release' | 'snapshot' | 'beta'
  gameVersion?: string
  notes?: string
  stable?: boolean
}

export interface LoaderSpec {
  kind: LoaderKind
  /** undefined for vanilla */
  version?: string
}

/* ------------------------------------------------------------------ */
/* instances                                                           */
/* ------------------------------------------------------------------ */

export interface InstanceConfig {
  /** Friendly name; unique-ish, used for lists only. */
  name: string
  gameVersion: string
  loaders: LoaderSpec[]
  /** Optional pin of the java executable; empty = auto. */
  javaPath?: string
  memory: { minMb: number; maxMb: number }
  jvmArgs: string[]
  gameArgs: string[]
  window: { width: number; height: number; fullscreen: boolean }
  /** Optional custom icon PNG/JPG path relative to the instance directory. */
  icon?: string
  notes?: string
}

export interface Instance extends InstanceConfig {
  id: string
  /** Absolute path of the instance directory. */
  path: string
  /** mtime of the instance config, monotonic counter for optimistic UI. */
  revision: number
  createdAt: number
  lastLaunchedAt?: number
  playTimeMs: number
}

/* ------------------------------------------------------------------ */
/* files / mods                                                        */
/* ------------------------------------------------------------------ */

export interface InstanceFile {
  /** Path relative to the instance directory, POSIX separators. */
  path: string
  name: string
  isDirectory: boolean
  size: number
  modifiedAt: number
}

export interface ModFile extends InstanceFile {
  /** Parsed descriptor when readable (mods/*.jar). */
  meta?: ModMeta
  enabled: boolean
  /** Raw file name on disk (a disabled mod keeps .disabled). */
  diskName: string
}

export interface ModMeta {
  id?: string
  name?: string
  version?: string
  description?: string
  authors?: string[]
  loader?: LoaderKind
  gameVersions?: string[]
  dependencies?: { id: string; versionRange?: string; optional?: boolean }[]
  icon?: string
}

export interface ModUpdateInfo {
  diskName: string
  modId?: string
  currentVersion?: string
  status: 'update' | 'current' | 'unknown' | 'error'
  latestVersion?: string
  latestVersionId?: string
  downloadUrl?: string
  fileName?: string
  updateId?: string
  hashes?: Record<string,string>
  size?: number
  source: 'modrinth' | 'curseforge'
  changelog?: string
  error?: {code:string;message:string}
}

export interface ModpackManifest {
  format: 'modrinth' | 'curseforge'
  name: string
  version?: string
  author?: string
  summary?: string
  gameVersion: string
  loaders: LoaderSpec[]
  files: { path: string; url: string; sha1?: string; size?: number }[]
}

/* ------------------------------------------------------------------ */
/* accounts                                                            */
/* ------------------------------------------------------------------ */

export type AccountKind = 'offline' | 'microsoft' | 'authlib-injector'

export interface Account {
  id: string
  kind: AccountKind
  name: string
  uuid: string
  avatar?: string
  /** Microsoft / authlib-injector access token. */
  accessToken?: string
  refreshToken?: string
  expiresAt?: number
  skinModel?: 'classic' | 'slim'
  /** authlib-injector: base URL of the Yggdrasil API server (e.g. LittleSkin). */
  authServerUrl?: string
  clientToken?: string
  /** OAuth application/authority that issued this account's refresh token. */
  microsoftClientId?: string
  microsoftAuthority?: string
}

export interface DeviceCodeFlow {
  flowId?: string
  clientId?: string
  authority?: string
  userCode: string
  verificationUri: string
  deviceCode: string
  intervalMs: number
  expiresAt: number
}

/* ------------------------------------------------------------------ */
/* java                                                                */
/* ------------------------------------------------------------------ */

export interface JavaRuntime {
  path: string
  version: string
  majorVersion: number
  vendor: string
  arch: 'x64' | 'arm64' | 'x86' | 'unknown'
  /** true when the runtime was downloaded into <root>/java automatically. */
  managed: boolean
}

/* ------------------------------------------------------------------ */
/* market (Modrinth / CurseForge)                                      */
/* ------------------------------------------------------------------ */

export type MarketSource = 'modrinth' | 'curseforge'
export type ProjectType = 'mod' | 'resourcepack' | 'shader' | 'modpack' | 'datapack' | 'plugin'

export interface MarketProject {
  source: MarketSource
  id: string
  slug: string
  title: string
  description: string
  iconUrl?: string
  downloads: number
  follows?: number
  categories: string[]
  gameVersions: string[]
  loaders: string[]
  projectType: ProjectType
  updatedAt: string
  author?: string
}

export interface MarketVersion {
  source: MarketSource
  id: string
  projectId: string
  name: string
  versionNumber: string
  releaseType: 'release' | 'beta' | 'alpha'
  gameVersions: string[]
  loaders: string[]
  downloads: number
  publishedAt: string
  file: { url: string; fileName: string; size: number; hashes?: Record<string, string> }
  dependencies: { projectId?: string; versionId?: string; type: 'required' | 'optional' | 'incompatible' }[]
}

export interface MarketSearchResult {
  hits: MarketProject[]
  total: number
  offset: number
  limit: number
}

/* ------------------------------------------------------------------ */
/* launch                                                              */
/* ------------------------------------------------------------------ */

export interface LaunchRequest {
  instanceId: string
  accountId: string
  /** Optional overrides. */
  memoryMb?: number
  javaPath?: string
  extraJvmArgs?: string[]
  extraGameArgs?: string[]
  /** Run in a detached process and keep the launcher UI responsive. */
  detach?: boolean
}

export interface LaunchSession {
  id: string
  instanceId: string
  accountName: string
  pid?: number
  startedAt: number
  endedAt?: number
  exitCode?: number
  status: 'starting' | 'running' | 'exited' | 'crashed' | 'stopped'
  command: string[]
  logFile: string
}

/* ------------------------------------------------------------------ */
/* settings                                                            */
/* ------------------------------------------------------------------ */

export interface Settings {
  language: 'zh-CN' | 'en-US'
  /** Root directory holding instances/ assets/ libraries/ java/ etc. */
  dataDir: string | null
  /** Concurrent downloads. */
  concurrency: number
  /** Base URLs; first entry wins, others are fallbacks. */
  mirrors: {
    versionManifest: string
    launcherMeta: string
    assets: string
    maven: string
    fabric: string
    forge: string
    neoforge: string
    quilt: string
    modrinth: string
    curseforge: string
  }
  proxy?: { enabled: boolean; host: string; port: number; username?: string; password?: string }
  /** Auto download a matching JRE when none is installed. */
  autoDownloadJava: boolean
  /** Keep N recent log files per instance. */
  keepLogs: number
  /** Opt into snapshots in the version list. */
  showSnapshots: boolean
  /** Download source: official or mirror (BMCLAPI style). */
  downloadSource: 'official' | 'mirror'
  theme: 'archive' | 'midnight' | 'light'
  /** OAuth application registered for this launcher; no unrelated project's identity is borrowed. */
  microsoftClientId?: string
  microsoftAuthority?: string
  authlibInjectorMirror?: string
  curseforgeApiKey?: string
}

/* ------------------------------------------------------------------ */
/* websocket / SSE event envelope                                      */
/* ------------------------------------------------------------------ */

export type ServerEvent =
  | { type: 'task'; task: TaskSnapshot }
  | { type: 'instance'; instance: Instance }
  | { type: 'instance-removed'; id: string }
  | { type: 'launch'; session: LaunchSession }
  | { type: 'launch-log'; sessionId: string; lines: LogLine[] }
  | { type: 'launch-exit'; sessionId: string; exitCode: number | null; status: LaunchSession['status'] }
  | { type: 'settings'; settings: Settings }
  | { type: 'notice'; level: 'info' | 'warn' | 'error'; message: string }

export interface Bootstrap {
  app: { name: string; version: string; pid: number; platform: string }
  paths: { root: string; instances: string; assets: string; libraries: string; java: string; logs: string }
  settings: Settings
  instances: Instance[]
  accounts: Account[]
  javaRuntimes: JavaRuntime[]
  sessions: LaunchSession[]
  tasks: TaskSnapshot[]
  plugins?: import('@rhine/plugin-api').FeatureSnapshot[]
  unavailable?: Record<string,{feature:string;status:string;code?:string;message?:string}>
}

export interface ApiError {
  code: string
  message: string
  detail?: string
}
