/**
 * Shell data layer.
 *
 * One bootstrap request feeds every page: the shell owns the store, pages read
 * from it and server events are folded back in. When the backend is not up the
 * store stays in the 'error' state so views can degrade to a skeleton or an
 * offline notice instead of a blank screen.
 */
import { create } from 'zustand'
import type {
  Account, Bootstrap, Instance, JavaRuntime, LaunchSession, ServerEvent, Settings,
  TaskSnapshot,
} from '@rhine/core'
import { api, subscribeServerEvents } from '../api/client.ts'
import { toast } from '../ui/toast.tsx'

/** Hard cap on the in-memory event lists so a long session cannot grow. */
const MAX_NOTICES = 50
const MAX_TASKS = 50

export type LoadStatus = 'idle' | 'loading' | 'ready' | 'error'
export type ConnectionState = 'connecting' | 'online' | 'offline'

/** One message broadcast by the backend over the websocket. */
export interface ServerNotice {
  id: number
  level: 'info' | 'warn' | 'error'
  message: string
  time: number
}

let eventSeed = 0

export interface AppState {
  status: LoadStatus
  error: string | null
  connection: ConnectionState
  app: Bootstrap['app'] | null
  paths: Bootstrap['paths'] | null
  settings: Settings | null
  instances: Instance[]
  accounts: Account[]
  javaRuntimes: JavaRuntime[]
  sessions: LaunchSession[]
  tasks: TaskSnapshot[]
  /** Latest backend notices (newest first), consumed by the logs page. */
  notices: ServerNotice[]

  /** Load once; safe to call from every mount point. */
  init: (signal?:AbortSignal) => Promise<void>
  /** Force a fresh bootstrap (used by the refresh buttons). */
  reload: (signal?:AbortSignal) => Promise<void>
  setConnection: (state: ConnectionState) => void
  /** Fold one websocket event into the store. */
  applyEvent: (event: ServerEvent) => void
  /** Local patch used for optimistic UI after a successful API call. */
  patchInstance: (instance: Instance) => void
  removeInstance: (id: string) => void
  patchSettings: (settings: Settings) => void
}

let started: Promise<void> | null = null
let unsubscribe: (() => void) | null = null
let bootstrapController:AbortController|null=null
let bootstrapEpoch=0

export const useAppStore = create<AppState>((set, get) => ({
  status: 'idle',
  error: null,
  connection: 'connecting',
  app: null,
  paths: null,
  settings: null,
  instances: [],
  accounts: [],
  javaRuntimes: [],
  sessions: [],
  tasks: [],
  notices: [],

  init: (signal) => {
    if (started) return started
    started = get().reload(signal)
    return started
  },

  reload: async (signal) => {
    bootstrapController?.abort()
    const controller=new AbortController(),epoch=++bootstrapEpoch
    bootstrapController=controller
    const combined=signal?AbortSignal.any([signal,controller.signal]):controller.signal
    set({ status: get().status === 'ready' ? 'ready' : 'loading', error: null })
    try {
      const bootstrap = await api.bootstrap(combined)
      if(combined.aborted||epoch!==bootstrapEpoch)return
      set({
        status: 'ready',
        error: null,
        connection: 'online',
        app: bootstrap.app,
        paths: bootstrap.paths,
        settings: bootstrap.settings,
        instances: bootstrap.instances ?? [],
        accounts: bootstrap.accounts ?? [],
        javaRuntimes: bootstrap.javaRuntimes ?? [],
        sessions: bootstrap.sessions ?? [],
        tasks: bootstrap.tasks ?? [],
      })
    } catch (error) {
      if(combined.aborted||epoch!==bootstrapEpoch)return
      const message = error instanceof Error ? error.message : '无法连接到启动器后端'
      set({ status: 'error', error: message, connection: 'offline' })
      started = null
    }
  },

  setConnection: (connection) => set({ connection }),

  applyEvent: (event) => {
    switch (event.type) {
      case 'task': {
        const tasks = get().tasks.filter((task) => task.id !== event.task.id)
        tasks.unshift(event.task)
        set({ tasks: tasks.slice(0, MAX_TASKS) })
        // Terminal states are kept as-is; the task list is capped above.
        break
      }
      case 'instance': {
        const others = get().instances.filter((item) => item.id !== event.instance.id)
        set({ instances: [...others, event.instance].sort(byCreated) })
        break
      }
      case 'instance-removed':
        set({ instances: get().instances.filter((item) => item.id !== event.id) })
        break
      case 'launch': {
        const others = get().sessions.filter((item) => item.id !== event.session.id)
        set({ sessions: [event.session, ...others] })
        break
      }
      case 'launch-exit': {
        set({
          sessions: get().sessions.map((session) =>
            session.id === event.sessionId
              ? { ...session, status: event.status, exitCode: event.exitCode ?? undefined, endedAt: Date.now() }
              : session,
          ),
        })
        break
      }
      case 'settings':
        set({ settings: event.settings })
        break
      case 'notice': {
        const notice: ServerNotice = {
          id: ++eventSeed,
          level: event.level,
          message: event.message,
          time: Date.now(),
        }
        set({ notices: [notice, ...get().notices].slice(0, MAX_NOTICES) })
        pushNotice(event.level, event.message)
        if (event.level !== 'info') {
          toast.show({ level: event.level, message: event.message })
        }
        break
      }
      default:
        break
    }
  },

  patchInstance: (instance) => {
    const exists = get().instances.some((item) => item.id === instance.id)
    set({
      instances: exists
        ? get().instances.map((item) => (item.id === instance.id ? instance : item))
        : [...get().instances, instance].sort(byCreated),
    })
  },

  removeInstance: (id) => set({ instances: get().instances.filter((item) => item.id !== id) }),

  patchSettings: (settings) => set({ settings }),
}))

function byCreated(a: Instance, b: Instance): number {
  return a.createdAt - b.createdAt
}

/* ------------------------------------------------------------------ */
/* server notices                                                      */
/* ------------------------------------------------------------------ */

let noticeSeed = 0
let notices: ServerNotice[] = []
const noticeListeners = new Set<(list: ServerNotice[]) => void>()

/** Push a notice broadcast by the backend into the shell's notice queue. */
export function pushNotice(level: ServerNotice['level'], message: string): void {
  noticeSeed += 1
  notices = [...notices.slice(-(MAX_NOTICES - 1)), { id: noticeSeed, level, message, time: Date.now() }]
  for (const listener of noticeListeners) listener(notices)
}

/** Read the current notice list (non-React call sites and tests). */
export function currentNotices(): ServerNotice[] {
  return notices
}

/** Clear the notice queue. */
export function clearNotices(): void {
  notices = []
  for (const listener of noticeListeners) listener(notices)
}

/** Subscribe to backend notices; returns the unsubscribe handle. */
export function subscribeNotices(listener: (list: ServerNotice[]) => void): () => void {
  noticeListeners.add(listener)
  listener(notices)
  return () => {
    noticeListeners.delete(listener)
  }
}

/** Sessions that are still alive. */
export function activeSessions(sessions: LaunchSession[]): LaunchSession[] {
  return sessions.filter((session) => session.status === 'starting' || session.status === 'running')
}

/** Format a byte count for the UI. */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const exponent = Math.min(units.length - 1, Math.floor(Math.log(bytes) / Math.log(1024)))
  const value = bytes / Math.pow(1024, exponent)
  return (exponent === 0 ? String(Math.round(value)) : value.toFixed(value >= 100 ? 0 : 1)) + ' ' + units[exponent]
}

/** Merge the store's settings with a safe fallback for views that render early. */
export function useSettings(): Settings | null {
  return useAppStore((state) => state.settings)
}
/** Native bootstrap-fiber inverse: release acquisitions, retain already committed UI data. */
export function stopAppData():void{
 ++bootstrapEpoch;bootstrapController?.abort();bootstrapController=null
 started=null
 const current=useAppStore.getState()
 useAppStore.setState({connection:'offline',status:current.app?'ready':'idle',error:null})
}
/** Realtime acquisition is separate from HTTP bootstrap and has its own inverse. */
export function startAppEvents():()=>void{
 const release=subscribeServerEvents(event=>{useAppStore.getState().setConnection('online');useAppStore.getState().applyEvent(event)})
 let closed=false
 return()=>{if(closed)return;closed=true;release();useAppStore.getState().setConnection('offline')}
}

