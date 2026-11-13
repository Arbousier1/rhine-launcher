/** Same-origin HTTP and the main-owned event origin, shared by all clients. */
export interface RhineDesktopBridge {
  protocolVersion?: number
  platform?: string
  apiBase?: string
  streamBaseUrl?: string
  versions?: { electron?: string; chrome?: string }
  openExternal?(url: string): Promise<void>
}
declare global { interface Window { rhineDesktop?: RhineDesktopBridge } }

/** Local API requests stay on the app origin; Electron performs HTTP forwarding. */
export function apiUrl(path: string): string {
  return path
}

/** DSH-style explicit stream base, separate from the custom-protocol HTTP proxy. */
export function websocketUrl(): string {
  const desktop = typeof window === 'undefined' ? undefined : window.rhineDesktop?.streamBaseUrl
  let target: URL
  if (desktop) {
    target = new URL('/ws', desktop)
    if (target.protocol !== 'http:' || target.hostname !== '127.0.0.1' || !target.port
      || target.username || target.password) throw new Error('Desktop event origin is invalid')
  } else {
    if (typeof location === 'undefined' || !['http:', 'https:'].includes(location.protocol) || !location.host) {
      throw new Error('This document has no realtime transport')
    }
    target = new URL('/ws', location.protocol + '//' + location.host)
  }
  target.protocol = target.protocol === 'https:' ? 'wss:' : 'ws:'
  return target.href
}
export function realtimeAvailable(): boolean {
  if (typeof WebSocket === 'undefined') return false
  try { websocketUrl(); return true } catch { return false }
}
