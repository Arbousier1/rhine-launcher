import { createVirtualDeskGap, type VirtualTransportOptions } from './virtual-deskgap.ts'
import { createHttpInvoke } from './http-invoke.ts'

type VirtualDeskGap = ReturnType<typeof createVirtualDeskGap>
export type EllanWindow = Window & Pick<typeof globalThis, 'WebSocket'> & { deskgap?: VirtualDeskGap }
interface DesktopBridge {
  streamBaseUrl?: string
  onFilesDropped?: VirtualTransportOptions['onFilesDropped']
}

function desktopBridges(target: Window): DesktopBridge[] {
  const bridges: DesktopBridge[] = []
  const read = (host: Window) => {
    const bridge = (host as Window & { rhineDesktop?: DesktopBridge }).rhineDesktop
    if (bridge) bridges.push(bridge)
  }
  read(target)
  // Main owns preload metadata. A same-origin iframe can read it from its parent;
  // a cross-origin parent is not a trusted replacement and cannot be inspected.
  try { if (target.parent && target.parent !== target) read(target.parent) } catch { /* Cross-origin parent. */ }
  return bridges
}

/** HTTP stays same-origin; only /ws uses the explicit main-owned loopback origin. */
export function ellanWebSocketUrl(target: Window = window): string {
  const desktop = desktopBridges(target).find(bridge => bridge.streamBaseUrl !== undefined)
  let url: URL
  if (desktop) {
    let base: URL
    try { base = new URL(desktop.streamBaseUrl!) } catch { throw new Error('Invalid Ellan desktop event origin') }
    if (base.protocol !== 'http:' || base.hostname !== '127.0.0.1' || !base.port
      || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new Error('Invalid Ellan desktop event origin')
    }
    url = new URL('/ws', base)
  } else {
    const { protocol, host } = target.location
    if (!['http:', 'https:'].includes(protocol) || !host) {
      throw new Error('Ellan custom-scheme documents require main/parent rhineDesktop.streamBaseUrl')
    }
    url = new URL('/ws', protocol + '//' + host)
  }
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
  return url.href
}

/** The existing native /ws bus is not an original DeskGap event stream. */
export function decodeEllanEvent(data: unknown): readonly unknown[] | undefined {
  if (typeof data !== 'string') return undefined
  let value: unknown
  try { value = JSON.parse(data) } catch { return undefined }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined
  const event = value as Record<string, unknown>
  if (event.type !== 'ellan' || typeof event.channel !== 'string' || !event.channel || !Array.isArray(event.args)) return undefined
  // Do not decode transport tags; the unchanged DeskGap reader does that once.
  return [event.channel, ...event.args]
}

export function createEllanEventSubscribe(target: EllanWindow): VirtualTransportOptions['subscribe'] {
  const url = ellanWebSocketUrl(target)
  if (typeof target.WebSocket !== 'function') throw new Error('Ellan realtime transport is unavailable')
  return listener => {
    let socket: WebSocket | undefined
    let reconnect: number | undefined
    let delay = 250
    let stopped = false
    const message = (event: MessageEvent<unknown>) => {
      if (stopped) return
      const original = decodeEllanEvent(event.data)
      if (original) listener(original)
    }
    const open = () => { delay = 250 }
    const detach = (current: WebSocket) => {
      current.removeEventListener('message', message)
      current.removeEventListener('open', open)
      current.removeEventListener('close', close)
    }
    const close = () => {
      if (socket) { detach(socket); socket = undefined }
      if (stopped) return
      reconnect = target.setTimeout(() => { reconnect = undefined; connect() }, delay)
      delay = Math.min(delay * 2, 30_000)
    }
    const connect = () => {
      if (stopped) return
      socket = new target.WebSocket(url)
      socket.addEventListener('message', message)
      socket.addEventListener('open', open)
      socket.addEventListener('close', close)
    }
    connect()
    return () => {
      if (stopped) return
      stopped = true
      if (reconnect !== undefined) target.clearTimeout(reconnect)
      if (socket) { detach(socket); socket.close(); socket = undefined }
    }
  }
}

/** Install only the declared provider, synchronously before the original DeskGap IIFE. */
export function installEllanTransport(target: EllanWindow = window): VirtualDeskGap {
  if (target.deskgap !== undefined) {
    throw new Error('Ellan transport is already installed; replace the renderer document instead of remounting')
  }
  const subscribe = createEllanEventSubscribe(target)
  const drops = desktopBridges(target).find(bridge => typeof bridge.onFilesDropped === 'function')
  const dropSubscriptions = new Set<() => void>()
  let disposed = false
  const http = createHttpInvoke({ fetch: target.fetch.bind(target) })
  let rendererId: string | undefined
  const native = desktopBridges(target).find(bridge => typeof (bridge as DesktopBridge & { windowCall?: unknown }).windowCall === 'function') as (DesktopBridge & { windowCall?(channel: string, args: unknown[]): Promise<unknown> }) | undefined
  const provider = createVirtualDeskGap({
    invoke: (message, owner, signal) => {
      rendererId = owner
      return message.channel.startsWith('window.') && native?.windowCall
        ? native.windowCall(message.channel, message.args) : http(message, owner, signal)
    }, subscribe,
    ...(drops ? { onFilesDropped: (listener: Parameters<NonNullable<VirtualTransportOptions['onFilesDropped']>>[0]) => {
      if (disposed) throw new Error('Ellan transport has been disposed')
      const unsubscribe = drops.onFilesDropped!(listener)
      const release = () => { if (dropSubscriptions.delete(release)) unsubscribe() }
      dropSubscriptions.add(release)
      return release
    } } : {}),
  })
  const disposeVirtual = provider.dispose
  const dispose = () => {
    if (disposed) return
    disposed = true
    if (rendererId) void target.fetch('/api/ellan/transport/release-renderer', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ rendererId, args: [] }), keepalive: true,
    }).catch(() => {})
    try { disposeVirtual() } finally {
      target.removeEventListener('pagehide', dispose)
      for (const unsubscribe of [...dropSubscriptions]) unsubscribe()
    }
  }
  provider.dispose = dispose
  target.deskgap = provider
  target.addEventListener('pagehide', dispose, { once: true })
  // Keep the disposed provider installed: the raw bridge owns globals, timers and
  // a reconnect loop with no teardown API. Lead must discard the iframe/native
  // document, not reinstall this bridge in the same realm.
  return provider
}

if (typeof window !== 'undefined') {
  installEllanTransport(window)
  void import('./extensions.ts').then(module => module.installUiExtensions(window)).catch(error => console.error('UI extensions failed:', error))
}
