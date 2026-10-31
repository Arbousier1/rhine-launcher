/**
 * Launch log buffers.
 *
 * Sessions themselves live in `useAppStore` (app/data.ts) — this store owns
 * only what the shell does not: the incremental log lines streamed by the
 * `launch-log` server event, per-session read state and the pause/autoscroll
 * preference of the log panel.
 *
 * The store subscribes to the shared WebSocket lazily, so importing it from a
 * page does not open a second connection.
 */
import { create } from 'zustand'
import type { LaunchSession, LogLine } from '@rhine/core'
import { subscribeServerEvents } from '@/api/client'
import { appendLines } from '@/features/logs/logs.ts'

/** Maximum lines retained per session in the browser buffer. */
export const LOG_BUFFER_LIMIT = 4000

interface LaunchLogState {
  /** Log lines per session id. */
  logs: Record<string, LogLine[]>
  /** Session id whose log panel is open in the logs page. */
  activeSessionId: string | null
  /** When true the panel stops following the tail. */
  paused: boolean
  /** Number of events received, used to re-render subscribers cheaply. */
  revision: number

  appendLog: (sessionId: string, lines: LogLine[]) => void
  setAll: (sessionId: string, lines: LogLine[]) => void
  clear: (sessionId: string) => void
  setActive: (sessionId: string | null) => void
  setPaused: (paused: boolean) => void
  togglePaused: () => void
}

export const useLaunchStore = create<LaunchLogState>((set) => ({
  logs: {},
  activeSessionId: null,
  paused: false,
  revision: 0,

  appendLog: (sessionId, lines) => {
    if (!lines.length) return
    set((state) => ({
      logs: {
        ...state.logs,
        [sessionId]: appendLines(state.logs[sessionId] ?? [], lines, LOG_BUFFER_LIMIT),
      },
      revision: state.revision + 1,
    }))
  },

  setAll: (sessionId, lines) => {
    set((state) => ({
      logs: { ...state.logs, [sessionId]: appendLines([], lines, LOG_BUFFER_LIMIT) },
      revision: state.revision + 1,
    }))
  },

  clear: (sessionId) => {
    set((state) => {
      const logs = { ...state.logs }
      delete logs[sessionId]
      return { logs, revision: state.revision + 1 }
    })
  },

  setActive: (activeSessionId) => set({ activeSessionId, paused: false }),

  setPaused: (paused) => set({ paused }),

  togglePaused: () => set((state) => ({ paused: !state.paused })),
}))

/** Read the buffered lines of a session without subscribing. */
export function sessionLogs(sessionId: string | null | undefined): LogLine[] {
  if (!sessionId) return []
  return useLaunchStore.getState().logs[sessionId] ?? []
}

/* ------------------------------------------------------------------ */
/* websocket wiring                                                    */
/* ------------------------------------------------------------------ */

let unsubscribe: (() => void) | null = null

/**
 * Start folding `launch-log` events into the buffer.
 *
 * Idempotent: the shared socket already exists thanks to the app store, this
 * only adds a handler. Returns a teardown function.
 */
export function attachLaunchLogStream(): () => void {
  if (unsubscribe) return unsubscribe
  unsubscribe = subscribeServerEvents((event) => {
    if (event.type === 'launch-log') {
      useLaunchStore.getState().appendLog(event.sessionId, event.lines)
    } else if (event.type === 'launch') {
      const { activeSessionId } = useLaunchStore.getState()
      if (!activeSessionId) useLaunchStore.getState().setActive(event.session.id)
    }
  })
  return unsubscribe
}

/** Drop the launch-log handler (used when the logs page unmounts). */
export function detachLaunchLogStream(): void {
  unsubscribe?.()
  unsubscribe = null
}

/** Sessions that are still alive, exported for page convenience. */
export function runningSessions(sessions: LaunchSession[]): LaunchSession[] {
  return sessions.filter((session) => session.status === 'starting' || session.status === 'running')
}
