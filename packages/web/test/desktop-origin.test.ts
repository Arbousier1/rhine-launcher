import { afterEach, describe, expect, it, vi } from 'vitest'
import { apiUrl, realtimeAvailable, websocketUrl } from '../src/api/origin.ts'
afterEach(() => vi.unstubAllGlobals())

describe('desktop and browser share API paths and explicit event origins', () => {
  it('keeps API URLs same-origin, even when an old absolute preload base exists', () => {
    vi.stubGlobal('window', { rhineDesktop: { apiBase: 'http://127.0.0.1:6550' } })
    expect(apiUrl('/api/bootstrap')).toBe('/api/bootstrap')
  })
  it('uses the main-owned port rather than the custom protocol hostname', () => {
    vi.stubGlobal('location', { protocol: 'rhine-app:', host: 'app' })
    vi.stubGlobal('window', { rhineDesktop: { streamBaseUrl: 'http://127.0.0.1:19876' } })
    vi.stubGlobal('WebSocket', class {})
    expect(websocketUrl()).toBe('ws://127.0.0.1:19876/ws')
    expect(realtimeAvailable()).toBe(true)
  })
  it('keeps browser HTTPS on WSS', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('location', { protocol: 'https:', host: 'localhost:19876' })
    expect(websocketUrl()).toBe('wss://localhost:19876/ws')
  })
  it('reports unsupported custom pages when no event origin is provided', () => {
    vi.stubGlobal('window', {})
    vi.stubGlobal('location', { protocol: 'rhine-app:', host: 'app' })
    vi.stubGlobal('WebSocket', class {})
    expect(realtimeAvailable()).toBe(false)
    expect(() => websocketUrl()).toThrow('no realtime')
  })
  it.each(['https://attacker.invalid', 'http://user@127.0.0.1:1234', 'http://127.0.0.1'])('rejects unsafe stream metadata %s', streamBaseUrl => {
    vi.stubGlobal('window', { rhineDesktop: { streamBaseUrl } })
    expect(() => websocketUrl()).toThrow('invalid')
  })
})
