/**
 * In-memory `RhContext` used by the route tests.
 *
 * Every service is a hand written double that records its calls, so a test can
 * assert both the HTTP response and that the server delegated to core instead
 * of reimplementing a business rule. Nothing here talks to the network or the
 * real file system: the doubles are only a stand-in for the *transport* layer,
 * which is exactly what the HTTP tests exercise.
 */
import type {
  Account, Bootstrap, DeviceCodeFlow, Instance, InstanceConfig, InstanceFile, JavaRuntime,
  LaunchRequest, LaunchSession, LoaderKind, LoaderSpec, LoaderVersion, LogLine, MarketProject,
  MarketSearchInput, MarketSearchResult, MarketVersion, ModFile, Progress, RemoteVersion,
  ServerEvent, Settings, TaskSnapshot,
} from '@rhine/core'
import type { RhContext } from '@rhine/core'
import type { Ctx } from '../src/routes/shared.ts'
import type { DiagnosticsApi } from '../src/types.ts'
import { testRuntime } from './runtime-context.ts'

/** Everything the doubles recorded, asserted by the tests. */
export interface MockCalls {
  instances: string[]
  meta: string[]
  loader: string[]
  java: string[]
  accounts: string[]
  mods: string[]
  market: string[]
  launch: string[]
  settings: string[]
  tasks: string[]
  bus: ServerEvent[]
}

/** A test double for every service plus the recorded call log. */
export interface MockContext {
  ctx: Ctx
  calls: MockCalls
  /** Push an event through the fake bus (used by the WS tests). */
  emit(event: ServerEvent): void
  /** Number of live bus subscribers. */
  subscribers(): number
  /** Simulated settings object, mutated by `PATCH /api/settings`. */
  state: MockState
}

/** Mutable state backing the doubles. */
export interface MockState {
  settings: Settings
  instances: Instance[]
  accounts: Account[]
  java: JavaRuntime[]
  sessions: LaunchSession[]
  tasks: TaskSnapshot[]
}

/** A frozen settings baseline that satisfies every field of `Settings`. */
export function defaultSettings(root = 'C:/rhine-data'): Settings {
  return {
    language: 'zh-CN',
    dataDir: root,
    concurrency: 8,
    mirrors: {
      versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
      launcherMeta: 'https://launchermeta.mojang.com',
      assets: 'https://resources.download.minecraft.net',
      maven: 'https://libraries.minecraft.net',
      fabric: 'https://meta.fabricmc.net/v2',
      forge: 'https://files.minecraftforge.net/maven',
      neoforge: 'https://maven.neoforged.net/releases',
      quilt: 'https://meta.quiltmc.org/v3',
      modrinth: 'https://api.modrinth.com/v2',
      curseforge: 'https://api.curseforge.com/v1',
    },
    autoDownloadJava: true,
    keepLogs: 10,
    showSnapshots: false,
    downloadSource: 'official',
    theme: 'archive',
  }
}

/** Build an instance fixture with sane defaults. */
export function makeInstance(overrides: Partial<Instance> = {}): Instance {
  const id = overrides.id ?? 'archive-1'
  const base: Instance = {
    id,
    name: '原版档案',
    gameVersion: '1.21.4',
    loaders: [{ kind: 'fabric', version: '0.16.9' }],
    path: `/data/instances/${id}`,
    memory: { minMb: 512, maxMb: 4096 },
    jvmArgs: [],
    gameArgs: [],
    window: { width: 854, height: 480, fullscreen: false },
    revision: 1,
    createdAt: 1_700_000_000_000,
    playTimeMs: 0,
  }
  return { ...base, ...overrides }
}

/** Build a task snapshot fixture. */
export function makeTask(id = 'task-1'): TaskSnapshot {
  const progress: Progress = { value: 0, stage: 'resolve', current: 0, total: 0 }
  return {
    id,
    kind: 'version-install',
    title: '安装 Minecraft 1.21.4',
    status: 'running',
    progress,
    logs: [],
    createdAt: Date.now(),
  }
}

/** Build a launch session fixture. */
export function makeSession(id = 'session-1'): LaunchSession {
  return {
    id,
    instanceId: 'archive-1',
    accountName: 'Steve',
    startedAt: Date.now(),
    status: 'running',
    command: ['java', '-jar', 'client.jar'],
    logFile: '/data/instances/archive-1/logs/latest.log',
  }
}

/** Options accepted by {@link createMockContext}. */
export interface MockOptions {
  /** Root directory reported by `ctx.paths.get()`. */
  root?: string
  /** Mount the optional diagnostics service. */
  diagnostics?: DiagnosticsApi
}

/**
 * Create a fully populated in-memory context.
 *
 * @param options — overrides for the few values a test usually cares about.
 * @returns the context, its recorded calls and helpers.
 */
export function createMockContext(options: MockOptions = {}): MockContext {
  const root = options.root ?? 'C:/rhine-data'
  const state: MockState = {
    settings: defaultSettings(root),
    instances: [makeInstance()],
    accounts: [{
      id: 'offline-steve',
      kind: 'offline',
      name: 'Steve',
      uuid: '00000000000000000000000000000001',
    }],
    java: [{
      path: 'C:/Program Files/Java/jdk-21/bin/java.exe',
      version: '21.0.4',
      majorVersion: 21,
      vendor: 'Eclipse Adoptium',
      arch: 'x64',
      managed: false,
    }],
    sessions: [makeSession()],
    tasks: [makeTask()],
  }

  const calls: MockCalls = {
    instances: [], meta: [], loader: [], java: [], accounts: [], mods: [],
    market: [], launch: [], settings: [], tasks: [], bus: [],
  }

  const listeners = new Set<(event: ServerEvent) => void>()

  const bus = {
    emit(event: ServerEvent) {
      calls.bus.push(event)
      for (const listener of listeners) listener(event)
    },
    subscribe(listener: (event: ServerEvent) => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }

  const paths = {
    get: () => ({
      root,
      instances: `${root}/instances`,
      assets: `${root}/assets`,
      libraries: `${root}/libraries`,
      versions: `${root}/versions`,
      java: `${root}/java`,
      logs: `${root}/logs`,
      temp: `${root}/temp`,
    }),
    instance: (id: string) => `${root}/instances/${id}`,
    ensure: async () => {},
  }

  const storage = {
    read: async <T>(_file: string, fallback: T) => fallback,
    write: async () => {},
    readSync: <T>(_file: string, fallback: T) => fallback,
  }

  const settings = {
    get: () => state.settings,
    update: async (patch: Partial<Settings>) => {
      calls.settings.push(JSON.stringify(patch))
      state.settings = { ...state.settings, ...patch }
      bus.emit({ type: 'settings', settings: state.settings })
      return state.settings
    },
    resolved: () => state.settings,
  }

  const tasks = {
    run: (_title: string, kind: string, _body: (handle: unknown) => Promise<unknown>) => {
      calls.tasks.push(`run:${kind}`)
      const id = `task-${state.tasks.length + 1}`
      state.tasks.push({ ...makeTask(id), kind })
      return id
    },
    list: () => state.tasks,
    get: (id: string) => state.tasks.find((task) => task.id === id),
    cancel: (id: string) => {
      calls.tasks.push(`cancel:${id}`)
      const task = state.tasks.find((item) => item.id === id)
      if (!task || task.status === 'succeeded') return false
      task.status = 'cancelled'
      return true
    },
    clear: () => { state.tasks = [] },
    wait: async (id: string) => state.tasks.find((task) => task.id === id) ?? makeTask(id),
  }

  const meta = {
    remoteVersions: async (): Promise<RemoteVersion[]> => {
      calls.meta.push('remoteVersions')
      return [
        { id: '1.21.4', type: 'release', url: 'https://example.invalid/1.21.4.json', releaseTime: '2024-12-03T10:12:57+00:00', name: '1.21.4' },
        { id: '26.1-snapshot-1', type: 'snapshot', url: 'https://example.invalid/snap.json', releaseTime: '2025-01-02T10:00:00+00:00', name: '26.1-snapshot-1' },
      ]
    },
    remoteVersion: async (id: string) => (await meta.remoteVersions()).find((version) => version.id === id),
    versionJson: async (id: string) => { calls.meta.push(`versionJson:${id}`); return { id } },
    versionChain: async (id: string) => { calls.meta.push(`chain:${id}`); return [{ id }] },
    installed: async () => { calls.meta.push('installed'); return ['1.21.4'] },
    resolvedJson: async (id: string) => { calls.meta.push(`resolved:${id}`); return { id } },
    install: async (gameVersion: string) => { calls.meta.push(`install:${gameVersion}`) },
    isInstalled: async (id: string) => id === '1.21.4',
  }

  const loader = {
    versions: async (kind: LoaderKind, gameVersion: string): Promise<LoaderVersion[]> => {
      calls.loader.push(`versions:${kind}:${gameVersion}`)
      return [{ version: '0.16.9', type: 'release', gameVersion, stable: true }]
    },
    install: async (kind: LoaderKind, gameVersion: string, loaderVersion: string) => {
      calls.loader.push(`install:${kind}:${gameVersion}:${loaderVersion}`)
      return `${gameVersion}-${kind}`
    },
    detect: async (gameVersion: string): Promise<LoaderSpec[]> => {
      calls.loader.push(`detect:${gameVersion}`)
      return [{ kind: 'fabric', version: '0.16.9' }]
    },
  }

  const java = {
    scan: async (): Promise<JavaRuntime[]> => { calls.java.push('scan'); return state.java },
    cached: () => state.java,
    pick: (majorVersion: number) => state.java.find((runtime) => runtime.majorVersion >= majorVersion),
    install: async (component: string): Promise<JavaRuntime> => {
      calls.java.push(`install:${component}`)
      return state.java[0]
    },
  }

  const accounts = {
    list: () => state.accounts,
    get: (id: string) => state.accounts.find((account) => account.id === id),
    addOffline: async (name: string): Promise<Account> => {
      calls.accounts.push(`offline:${name}`)
      const account: Account = { id: `offline-${name}`, kind: 'offline', name, uuid: 'f'.repeat(32) }
      state.accounts.push(account)
      return account
    },
    remove: async (id: string) => {
      calls.accounts.push(`remove:${id}`)
      state.accounts = state.accounts.filter((account) => account.id !== id)
    },
    beginMicrosoft: async (): Promise<DeviceCodeFlow> => {
      calls.accounts.push('beginMicrosoft')
      return {
        userCode: 'ABCD-EFGH',
        verificationUri: 'https://microsoft.com/link',
        deviceCode: 'device-code',
        intervalMs: 5000,
        expiresAt: Date.now() + 900_000,
      }
    },
    completeMicrosoft: async (): Promise<Account> => {
      calls.accounts.push('completeMicrosoft')
      const account: Account = { id: 'ms-1', kind: 'microsoft', name: 'Alex', uuid: 'a'.repeat(32) }
      state.accounts.push(account)
      return account
    },
    refresh: async (id: string): Promise<Account> => {
      calls.accounts.push(`refresh:${id}`)
      const account = state.accounts.find((item) => item.id === id)
      if (!account) throw new Error('账号不存在')
      return account
    },
    authorize: async (id: string): Promise<Account> => {
      calls.accounts.push(`authorize:${id}`)
      const account = state.accounts.find((item) => item.id === id)
      if (!account) throw new Error('账号不存在')
      return account
    },
  }

  const instances = {
    list: () => state.instances,
    get: (id: string) => state.instances.find((instance) => instance.id === id),
    create: async (config: InstanceConfig): Promise<Instance> => {
      calls.instances.push(`create:${config.name}`)
      const instance = makeInstance({ ...config, id: `archive-${state.instances.length + 1}` })
      state.instances.push(instance)
      return instance
    },
    update: async (id: string, patch: Partial<InstanceConfig>): Promise<Instance> => {
      calls.instances.push(`update:${id}`)
      const index = state.instances.findIndex((instance) => instance.id === id)
      if (index < 0) throw new Error(`实例不存在：${id}`)
      const next = { ...state.instances[index], ...patch, revision: state.instances[index].revision + 1 }
      state.instances[index] = next
      return next
    },
    remove: async (id: string) => {
      calls.instances.push(`remove:${id}`)
      state.instances = state.instances.filter((instance) => instance.id !== id)
    },
    duplicate: async (id: string, name: string): Promise<Instance> => {
      calls.instances.push(`duplicate:${id}`)
      return makeInstance({ id: `${id}-copy`, name })
    },
    files: async (id: string, subdir?: string): Promise<InstanceFile[]> => {
      calls.instances.push(`files:${id}:${subdir ?? ''}`)
      return [{
        path: `${subdir ?? '.'}/options.txt`,
        name: 'options.txt',
        isDirectory: false,
        size: 42,
        modifiedAt: 1_700_000_000_000,
      }]
    },
    readFile: async (id: string, relative: string) => {
      calls.instances.push(`readFile:${id}:${relative}`)
      return 'version:1.21.4\n'
    },
    writeFile: async (id: string, relative: string) => {
      calls.instances.push(`writeFile:${id}:${relative}`)
    },
    deleteFile: async (id: string, relative: string) => {
      calls.instances.push(`deleteFile:${id}:${relative}`)
    },
  }

  const mods = {
    list: async (instanceId: string): Promise<ModFile[]> => {
      calls.mods.push(`list:${instanceId}`)
      return [{
        path: 'mods/sodium.jar',
        name: 'sodium.jar',
        isDirectory: false,
        size: 1024,
        modifiedAt: 1_700_000_000_000,
        enabled: true,
        diskName: 'sodium.jar',
        meta: { id: 'sodium', name: 'Sodium', version: '0.6.0' },
      }]
    },
    setEnabled: async (instanceId: string, diskName: string, enabled: boolean): Promise<ModFile> => {
      calls.mods.push(`toggle:${instanceId}:${diskName}:${enabled}`)
      return {
        path: `mods/${diskName}`,
        name: diskName,
        isDirectory: false,
        size: 1024,
        modifiedAt: 1_700_000_000_000,
        enabled,
        diskName: enabled ? diskName : `${diskName}.disabled`,
      }
    },
    remove: async (instanceId: string, diskName: string) => {
      calls.mods.push(`remove:${instanceId}:${diskName}`)
    },
    install: async (instanceId: string, url: string, fileName: string): Promise<ModFile> => {
      calls.mods.push(`install:${instanceId}:${fileName}`)
      return {
        path: `mods/${fileName}`,
        name: fileName,
        isDirectory: false,
        size: 1,
        modifiedAt: 0,
        enabled: true,
        diskName: fileName,
      }
    },
    inspect: async (jarPath: string) => {
      calls.mods.push(`inspect:${jarPath}`)
      return { id: 'sodium' }
    },
  }

  const market = {
    search: async (query: MarketSearchInput): Promise<MarketSearchResult> => {
      calls.market.push(`search:${query.source}:${query.query}`)
      const project: MarketProject = {
        source: query.source,
        id: 'AANobbMI',
        slug: 'sodium',
        title: 'Sodium',
        description: '现代渲染优化',
        downloads: 12_345,
        categories: ['optimization'],
        gameVersions: ['1.21.4'],
        loaders: ['fabric'],
        projectType: 'mod',
        updatedAt: '2025-01-01T00:00:00Z',
      }
      return { hits: [project], total: 1, offset: query.offset ?? 0, limit: query.limit ?? 20 }
    },
    project: async (source: 'modrinth' | 'curseforge', id: string): Promise<MarketProject> => {
      calls.market.push(`project:${source}:${id}`)
      return {
        source, id, slug: id, title: 'Sodium', description: '',
        downloads: 0, categories: [], gameVersions: [], loaders: [],
        projectType: 'mod', updatedAt: '2025-01-01T00:00:00Z',
      }
    },
    versions: async (source: 'modrinth' | 'curseforge', projectId: string): Promise<MarketVersion[]> => {
      calls.market.push(`versions:${source}:${projectId}`)
      return [{
        source,
        id: 'ver-1',
        projectId,
        name: 'Sodium 0.6.0',
        versionNumber: '0.6.0',
        releaseType: 'release',
        gameVersions: ['1.21.4'],
        loaders: ['fabric'],
        downloads: 10,
        publishedAt: '2025-01-01T00:00:00Z',
        file: { url: 'https://example.invalid/sodium.jar', fileName: 'sodium.jar', size: 1024 },
        dependencies: [],
      }]
    },
    install: async (instanceId: string, version: MarketVersion): Promise<InstanceFile> => {
      calls.market.push(`install:${instanceId}:${version.id}`)
      return {
        path: `mods/${version.file.fileName}`,
        name: version.file.fileName,
        isDirectory: false,
        size: version.file.size,
        modifiedAt: 0,
      }
    },
  }

  const launch = {
    launch: async (request: LaunchRequest): Promise<LaunchSession> => {
      calls.launch.push(`launch:${request.instanceId}`)
      const session = makeSession(`session-${state.sessions.length + 1}`)
      state.sessions.push(session)
      return session
    },
    sessions: () => state.sessions,
    session: (id: string) => state.sessions.find((session) => session.id === id),
    kill: async (sessionId: string) => {
      calls.launch.push(`kill:${sessionId}`)
      const session = state.sessions.find((item) => item.id === sessionId)
      if (session) session.status = 'stopped'
    },
    buildCommand: async (request: LaunchRequest) => {
      calls.launch.push(`build:${request.instanceId}`)
      return { command: ['java', '-jar', 'client.jar'], cwd: '/data/instances/archive-1', mainClass: 'net.minecraft.client.main.Main' }
    },
    log: (sessionId: string, tail?: number): LogLine[] => {
      calls.launch.push(`log:${sessionId}:${tail ?? 0}`)
      return [{ time: Date.now(), level: 'info', message: 'Starting Minecraft' }]
    },
  }

  const ctx = {
    paths,
    storage,
    settings,
    bus,
    tasks,
    meta,
    loader,
    java,
    accounts,
    instances,
    mods,
    market,
    launch,
    ...(options.diagnostics ? { diagnostics: options.diagnostics } : {}),
    // `logger` is part of the Cordis context; a no-op facade keeps the app quiet.
    logger: () => ({ debug() {}, info() {}, warn() {}, error() {} }),
  } as unknown as Ctx
  ;(ctx as unknown as RhContext).features = testRuntime(ctx)

  return {
    ctx,
    calls,
    state,
    emit: (event: ServerEvent) => bus.emit(event),
    subscribers: () => listeners.size,
  }
}

/** Convenience: the `RhContext` type re-exported for test signatures. */
export type { RhContext, Bootstrap }
