import { defineFeature, FeatureError } from '@rhine/plugin-api'
import { launcherIssue, launcherState, type LauncherIssue } from '../launcher-state'
import { instance, object, session, task, text } from './internal/validation'

export interface LauncherEventsHandle { close(): void }
export interface LauncherEventsOptions { force?: boolean }
interface LiveConnection { handle: LauncherEventsHandle; signal: AbortSignal }
interface ConnectionSlot { current?: LiveConnection }

export default defineFeature<LauncherEventsOptions | undefined, LauncherEventsHandle>({
  id: 'launcher.events.connect', capability: 'launcher.events.connect', title: '订阅启动器实时事件',
  optionalDepends: ['launcher.bootstrap'],
  setup(env) {
    const state = launcherState(env)
    state.setConnection('disconnected')
    env.onDispose(() => { state.setConnection('disabled') })
  },
  execute(options, env) {
    const state = launcherState(env)
    const slot = env.state<ConnectionSlot>('rhine.launcher.events.connection', () => ({}))
    if (slot.current && !slot.current.signal.aborted && !options?.force) return slot.current.handle
    slot.current?.handle.close()
    let stopped = false
    let socket: WebSocket | undefined
    let detach = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    let retries = 0
    const current = () => !stopped && !env.signal.aborted && !state.closed && slot.current === connection
    const close = () => {
      if (stopped) return
      stopped = true
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      detach()
      const old = socket; socket = undefined
      try { old?.close() } catch { /* Closing a failed/connecting socket is best effort. */ }
      env.signal.removeEventListener('abort', close)
      if (slot.current === connection) {
        slot.current = undefined
        state.setConnection('disconnected')
      }
    }
    const connection: LiveConnection = { signal: env.signal, handle: { close } }
    slot.current = connection
    env.signal.addEventListener('abort', close, { once: true })
    env.onDispose(close)
    const retry = (error: LauncherIssue) => {
      if (!current()) return
      detach()
      const old = socket; socket = undefined
      try { old?.close() } catch { /* Error callbacks must never escape into the browser. */ }
      state.setConnection('disconnected', error)
      if (!current()) return
      const delay = Math.min(1000 * 2 ** Math.min(retries++, 5), 30_000)
      state.setConnection('reconnecting', error)
      timer = setTimeout(connect, delay)
    }
    const connect = () => {
      timer = undefined
      if (!current()) return
      state.setConnection(retries ? 'reconnecting' : 'connecting', retries ? state.snapshot.connectionError : null)
      if (typeof WebSocket === 'undefined' || typeof location === 'undefined' || !['http:', 'https:'].includes(location.protocol) || !location.host) {
        close()
        state.setConnection('disconnected', launcherIssue(new FeatureError('REALTIME_UNAVAILABLE', '当前环境不支持实时连接，仍可手动刷新 HTTP 快照')))
        return
      }
      let next: WebSocket
      try { next = new WebSocket((location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + '/ws') }
      catch (error) { retry(launcherIssue(error)); return }
      socket = next
      const live = () => current() && socket === next
      const onOpen = () => {
        if (!live()) return
        const reconnect = retries > 0
        retries = 0
        state.setConnection('connected')
        // Fill gaps after a disconnect; this optional capability is never a hard dependency.
        if (reconnect && env.context.features.has('launcher.bootstrap')) {
          try { void Promise.resolve(env.use('launcher.bootstrap')).catch(() => {}) } catch { /* Bootstrap reports its own unavailable/error state. */ }
        }
      }
      const onMessage = (event: MessageEvent) => {
        if (!live()) return
        try {
          if (typeof event.data !== 'string') throw new FeatureError('INVALID_EVENT', '实时事件不是 JSON 文本（UNKNOWN）', 502)
          const payload = object(JSON.parse(event.data), '实时事件')
          const type = text(payload.type, '事件类型')
          if (type === 'instance') state.upsertInstance(instance(payload.instance))
          else if (type === 'instance-removed') state.removeInstance(text(payload.id, '实例 id'))
          else if (type === 'launch') state.upsertSession(session(payload.session))
          else if (type === 'launch-exit') {
            const id = text(payload.sessionId, '会话 id'), status = text(payload.status, '会话状态')
            const code = payload.exitCode
            if (code !== null && code !== undefined && (typeof code !== 'number' || !Number.isFinite(code))) throw new FeatureError('INVALID_EVENT', '退出代码格式无效（UNKNOWN）', 502)
            const known = state.snapshot.sessions.find(item => item.id === id)
            if (known) state.upsertSession({ ...known, status, ...(code === undefined ? {} : { exitCode: code as number | null }) })
          } else if (type === 'task') state.upsertTask(task(payload.task))
          // Logs/notices/unknown future event types do not invalidate the snapshot.
        } catch (error) { state.setConnection(state.snapshot.connection, launcherIssue(error)) }
      }
      const onClose = () => { if (live()) retry({ code: 'REALTIME_DISCONNECTED', message: '实时连接已断开，正在重新连接；可手动刷新快照' }) }
      const onError = () => { if (live()) retry({ code: 'REALTIME_DISCONNECTED', message: '实时连接失败，正在重新连接；HTTP 操作仍可使用' }) }
      next.addEventListener('open', onOpen)
      next.addEventListener('message', onMessage)
      next.addEventListener('close', onClose)
      next.addEventListener('error', onError)
      detach = () => {
        next.removeEventListener('open', onOpen)
        next.removeEventListener('message', onMessage)
        next.removeEventListener('close', onClose)
        next.removeEventListener('error', onError)
      }
    }
    if (env.signal.aborted) close()
    else connect()
    return connection.handle
  },
})
