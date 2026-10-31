/**
 * Typed HTTP + WebSocket client for the Rhine launcher backend.
 *
 * Components never call fetch directly: every request goes through request(),
 * which normalises ApiError responses and keeps the surface in sync with the
 * routes defined in ARCHITECTURE.md section 4.
 */
import type {
  Account, ApiError, Bootstrap, DeviceCodeFlow, Instance, InstanceConfig,
  InstanceFile, JavaRuntime, LaunchRequest, LaunchSession, LoaderKind, LoaderVersion,
  LogLine, MarketSearchResult, MarketVersion, ModFile, ModUpdateInfo, ProjectType, RemoteVersion,
  ServerEvent, Settings, TaskSnapshot,
} from '@rhine/core'

/** Base URL of the backend; same-origin when the bundle is served by it. */
const BASE = ''

/** Error raised for non-2xx responses; code is stable for UI branching. */
export class RhineApiError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: string
  constructor(error: ApiError, status: number) {
    super(error.message)
    this.name = 'RhineApiError'
    this.code = error.code
    this.status = status
    this.detail = error.detail
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(BASE + path, {
      headers: init?.body ? { 'content-type': 'application/json' } : undefined,
      ...init,
    })
  } catch {
    throw new RhineApiError({ code: 'network', message: '无法连接到启动器后端，请确认服务已启动' }, 0)
  }
  const text = await response.text()
  const body = text ? safeParse(text) : undefined
  if (!response.ok) {
    const error: ApiError =
      body && typeof body === 'object' && 'message' in (body as object)
        ? (body as ApiError)
        : { code: 'http_' + response.status, message: '请求失败（HTTP ' + response.status + '）' }
    throw new RhineApiError(error, response.status)
  }
  return body as T
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

const get = <T,>(path: string) => request<T>(path)
const post = <T,>(path: string, body?: unknown) =>
  request<T>(path, { method: 'POST', body: body === undefined ? undefined : JSON.stringify(body) })
const patch = <T,>(path: string, body: unknown) =>
  request<T>(path, { method: 'PATCH', body: JSON.stringify(body) })
const del = <T,>(path: string) => request<T>(path, { method: 'DELETE' })

const qs = (params: Record<string, string | number | boolean | undefined>): string => {
  const out: string[] = []
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === '') continue
    out.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)))
  }
  return out.length ? '?' + out.join('&') : ''
}

/** Namespaced API surface consumed by stores and pages. */
export const api = {
  bootstrap: (signal?:AbortSignal) => request<Bootstrap>('/api/bootstrap',{signal}),

  versions: {
    remote: () => get<RemoteVersion[]>('/api/versions/remote'),
    installed: () => get<string[]>('/api/versions/installed'),
    /** Start a vanilla install; progress arrives over the event stream. */
    install: (gameVersion: string) => post<{ taskId: string }>('/api/versions/install', { gameVersion }),
  },

  loaders: Object.assign(
    (kind: LoaderKind, gameVersion: string) =>
      get<LoaderVersion[]>('/api/loaders/' + kind + qs({ gameVersion })),
    {
      /** Start a loader install; progress arrives over the event stream. */
      install: (kind: LoaderKind, gameVersion: string, loaderVersion: string) =>
        post<{ taskId: string }>('/api/loaders/' + kind + '/install', { gameVersion, loaderVersion }),
    },
  ),

  instances: {
    list: () => get<Instance[]>('/api/instances'),
    get: (id: string) => get<Instance>('/api/instances/' + encodeURIComponent(id)),
    create: (config: InstanceConfig) => post<Instance>('/api/instances', config),
    importModpack: (path: string, name?: string) =>
      post<{ taskId: string }>('/api/instances/import-modpack', { path, name }),
    update: (id: string, body: Partial<InstanceConfig>) =>
      patch<Instance>('/api/instances/' + encodeURIComponent(id), body),
    remove: (id: string, deleteFiles = false) =>
      del<{ ok: true }>('/api/instances/' + encodeURIComponent(id) + qs({ deleteFiles })),
    duplicate: (id: string, name: string) =>
      post<Instance>('/api/instances/' + encodeURIComponent(id) + '/duplicate', { name }),
    files: (id: string, subdir?: string) =>
      get<InstanceFile[]>('/api/instances/' + encodeURIComponent(id) + '/files' + qs({ subdir })),
    readFile: (id: string, path: string) =>
      get<{ content: string }>('/api/instances/' + encodeURIComponent(id) + '/file' + qs({ path })),
    writeFile: (id: string, path: string, content: string) =>
      request<{ok:true}>('/api/instances/' + encodeURIComponent(id) + '/file',{method:'PUT',body:JSON.stringify({path,content})}),
    deleteFile: (id: string, path: string) =>
      del<{ ok: true }>('/api/instances/' + encodeURIComponent(id) + '/file' + qs({ path })),
    mods: (id: string) => get<ModFile[]>('/api/instances/' + encodeURIComponent(id) + '/mods'),
    toggleMod: (id: string, diskName: string, enabled: boolean) =>
      post<ModFile>('/api/instances/' + encodeURIComponent(id) + '/mods/' + encodeURIComponent(diskName) + '/toggle', { enabled }),
    deleteMod: (id: string, diskName: string) =>
      del<{ ok: true }>('/api/instances/' + encodeURIComponent(id) + '/mods/' + encodeURIComponent(diskName)),
    diagnostics: (id: string) =>
      get<{ level: 'info' | 'warn' | 'error'; message: string; hint?: string }[]>(
        '/api/instances/' + encodeURIComponent(id) + '/diagnostics',
      ),
    installMod: (id: string, url: string, fileName: string) =>
      post<{ taskId: string }>('/api/instances/' + encodeURIComponent(id) + '/mods', { url, fileName }),
    /** Copy a jar that already exists on disk (the launcher runs locally). */
    importMod: (id: string, path: string) =>
      post<ModFile>('/api/instances/' + encodeURIComponent(id) + '/mods/import', { path }),
    /** Check whether enabled mods have updates on Modrinth. */
    checkModUpdates: (id: string, source: 'modrinth'|'curseforge' = 'modrinth') =>
      get<ModUpdateInfo[]>('/api/instances/' + encodeURIComponent(id) + '/mods/updates' + (source === 'curseforge' ? '/curseforge' : '')),
    applyModUpdate: (id: string, updateId: string, diskName?: string) =>
      post<{taskId:string}>('/api/instances/' + encodeURIComponent(id) + '/mods/updates/apply', {updateId,diskName}),
  },

  market: {
    search: (input: {
      source: 'modrinth' | 'curseforge'
      query: string
      projectType?: ProjectType
      gameVersion?: string
      loader?: string
      offset?: number
      limit?: number
      sort?: string
    }) => get<MarketSearchResult>('/api/market/search' + qs(input)),
    versions: (source: 'modrinth' | 'curseforge', projectId: string, filter?: { gameVersion?: string; loader?: string }) =>
      get<MarketVersion[]>('/api/market/' + source + '/' + encodeURIComponent(projectId) + '/versions' + qs(filter ?? {})),
    install: (instanceId: string, version: MarketVersion) =>
      post<{ taskId: string }>('/api/market/install', { instanceId, version }),
  },

  accounts: {
    list: () => get<Account[]>('/api/accounts'),
    addOffline: (name: string) => post<Account>('/api/accounts/offline', { name }),
    addAuthlibInjector: (authServerUrl: string, username: string, password: string) =>
      post<Account>('/api/accounts/authlib-injector', { authServerUrl, username, password }),
    remove: (id: string) => del<{ ok: true }>('/api/accounts/' + encodeURIComponent(id)),
    beginMicrosoft: (options?: {clientId?:string;authority?:string}) => post<DeviceCodeFlow>('/api/accounts/microsoft/start',options),
    completeMicrosoft: (flowId?: string) => post<Account>('/api/accounts/microsoft/complete',flowId?{flowId}:undefined),
    refresh: (id: string) => post<Account>('/api/accounts/' + encodeURIComponent(id) + '/refresh'),
  },

  plugins: {
    list: () => get<{id:string;title:string;status:string;depends:string[];error?:string}[]>('/api/plugins'),
    enable: (id:string) => post<{ok:boolean}>('/api/plugins/'+encodeURIComponent(id)+'/enable'),
    disable: (id:string) => post<{ok:boolean}>('/api/plugins/'+encodeURIComponent(id)+'/disable'),
  },

  system: {
    /** Open a directory (or a file's folder) in the desktop file manager. */
    reveal: (path: string) => post<{ ok: true }>('/api/system/reveal', { path }),
    /** Open a URL in the default browser. */
    openExternal: (url: string) => post<{ ok: true }>('/api/system/open', { url }),
  },

  settings: {
    get: () => get<Settings>('/api/settings'),
    update: (body: Partial<Settings>) => patch<Settings>('/api/settings', body),
  },

  java: {
    list: () => get<JavaRuntime[]>('/api/java'),
    scan: () => post<JavaRuntime[]>('/api/java/scan'),
    install: (component: string) => post<{ taskId: string }>('/api/java/install', { component }),
  },

  tasks: {
    list: () => get<TaskSnapshot[]>('/api/tasks'),
    cancel: (id: string) => post<{ ok: true }>('/api/tasks/' + encodeURIComponent(id) + '/cancel'),
    clear: () => post<{ ok: true }>('/api/tasks/clear'),
  },

  launch: {
    start: (body: LaunchRequest) => post<LaunchSession>('/api/launch', body),
    sessions: () => get<LaunchSession[]>('/api/launch/sessions'),
    kill: (id: string) => post<{ ok: true }>('/api/launch/sessions/' + encodeURIComponent(id) + '/kill'),
    log: (id: string, tail = 400) =>
      get<{ sessionId: string; lines: LogLine[] }>(
        '/api/launch/sessions/' + encodeURIComponent(id) + '/log' + qs({ tail }),
      ),
    /** Dry run: build the argument vector without starting the game. */
    preview: (body: LaunchRequest) =>
      post<{ command: string[]; cwd: string; mainClass: string }>('/api/launch/build', body),
  },
}

export type RhineApi = typeof api

/* ------------------------------------------------------------------ */
/* server event stream                                                 */
/* ------------------------------------------------------------------ */

type EventHandler = (event: ServerEvent) => void

const handlers = new Set<EventHandler>()
let socket: WebSocket | undefined
let reconnectTimer: ReturnType<typeof setTimeout> | undefined
let reconnectDelay = 1000
let manuallyClosed = false

/** WebSocket URL derived from the current page origin (https becomes wss). */
export function websocketUrl(): string {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:'
  return protocol + '//' + location.host + '/ws'
}

function ensureSocket(): void {
  if (socket && (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING)) return
  manuallyClosed = false
  const connection = new WebSocket(websocketUrl())
  socket = connection
  connection.addEventListener('open', () => {
    reconnectDelay = 1000
  })
  connection.addEventListener('message', (event) => {
    const data = safeParse(String(event.data)) as ServerEvent | undefined
    if (!data || typeof data !== 'object' || !('type' in data)) return
    for (const handler of [...handlers]) {
      try {
        handler(data)
      } catch (error) {
        console.error('[rhine] server event handler failed', error)
      }
    }
  })
  connection.addEventListener('close', () => {
    if(socket!==connection)return
    socket = undefined
    if (manuallyClosed || handlers.size === 0) return
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 15_000)
      ensureSocket()
    }, reconnectDelay)
  })
  connection.addEventListener('error', () => {
    connection.close()
  })
}

/**
 * Subscribe to the backend event stream.
 * The socket is opened lazily and shared by every subscriber.
 */
export function subscribeServerEvents(handler: EventHandler): () => void {
  handlers.add(handler)
  ensureSocket()
  return () => {
    handlers.delete(handler)
    if (handlers.size === 0) {
      manuallyClosed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      reconnectTimer = undefined
      socket?.close()
      socket = undefined
    }
  }
}

/** Force a reconnect (used after the backend restarts). */
export function reconnectServerEvents(): void {
  manuallyClosed = true
  socket?.close()
  socket = undefined
  manuallyClosed = false
  if (handlers.size > 0) ensureSocket()
}