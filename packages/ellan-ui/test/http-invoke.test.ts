import { afterEach, describe, expect, it, vi } from 'vitest'
import { createHttpInvoke, EllanHttpError } from '../src/http-invoke.ts'
import { createEllanEventSubscribe, decodeEllanEvent, ellanWebSocketUrl, installEllanTransport, type EllanWindow } from '../src/entry.ts'
import { createVirtualDeskGap, type OriginalInvoke } from '../src/virtual-deskgap.ts'
import { TransportFrameDecoder } from '../vendor/deskgap/framing.ts'
import { prependBridgeScripts } from '../scripts/assemble.mjs'

const operation = (channel: string, args: unknown[] = []): OriginalInvoke => ({ type: 'invoke', id: 7, channel, args })
function frame(value: unknown) {
  const body = new TextEncoder().encode(JSON.stringify(value))
  const output = new Uint8Array(body.length + 4)
  new DataView(output.buffer).setUint32(0, body.length)
  output.set(body, 4)
  return output
}
function decode(value: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(new TransportFrameDecoder().push(value)[0]))
}
class FakeSocket extends EventTarget {
  static instances: FakeSocket[] = []
  constructor(readonly url: string) { super(); FakeSocket.instances.push(this) }
  close = vi.fn(() => this.dispatchEvent(new Event('close')))
  message(data: unknown) { this.dispatchEvent(new MessageEvent('message', { data })) }
}
function host(overrides: Record<string, unknown> = {}): EllanWindow {
  return Object.assign(new EventTarget(), {
    location: { protocol: 'http:', host: 'localhost:19876' }, parent: undefined,
    fetch: vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: 'ok' })),
    WebSocket: FakeSocket, setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
  }, overrides) as unknown as EllanWindow
}
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); FakeSocket.instances = [] })

describe('raw original invocation over HTTP', () => {
  it('routes ordinary service calls without unwrapping results or transport tags', async () => {
    const raw = { result: { __state__: 'Settings', id: 'settings-1', locale: 'zh-CN',
      optional: { __xmclTransportType: 'undefined' }, count: { __xmclTransportType: 'bigint', value: '9007199254740993' } }, method: 'getSettings' }
    const payload = [{ __xmclTransportType: 'bytes', value: 'AQID' }, { __xmclTransportType: 'undefined' }]
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(raw))
    const signal = new AbortController().signal
    const invoke = createHttpInvoke({ fetch: send })
    expect(await invoke(operation('service-call', ['BaseService', 'getSettings', ...payload]), 'renderer-original', signal)).toEqual(raw)
    const [path, init] = send.mock.calls[0]
    expect(path).toBe('/api/ellan/services/BaseService/getSettings')
    expect(init).toMatchObject({ method: 'POST', credentials: 'same-origin', signal, headers: { 'content-type': 'application/json', accept: 'application/json' } })
    expect(init?.signal).toBe(signal)
    expect(JSON.parse(init!.body as string)).toEqual({ rendererId: 'renderer-original', args: payload })
  })

  it('extracts trace context from the first argument of service-call-traced', async () => {
    const trace = { traceparent: '00-01234567890123456789012345678901-0123456789012345-01',
      tracestate: { __xmclTransportType: 'undefined' } }
    const args = ['profile', { __xmclTransportType: 'bytes', value: 'AA==' }]
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ result: null }))
    await createHttpInvoke({ fetch: send })(operation('service-call-traced', [trace, 'LaunchService', 'launch', ...args]), 'r2', new AbortController().signal)
    expect(send.mock.calls[0][0]).toBe('/api/ellan/services/LaunchService/launch')
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toEqual({ rendererId: 'r2', args, traceContext: trace })
  })

  it.each(['commit', 'revalidate', 'unref', 'task-poll', 'window.control', 'renderer-telemetry-flush', 'unknown.operation'])('POSTs %s to transport rather than inventing a local function', async channel => {
    const args = ['state-1', { __xmclTransportType: 'undefined' }]
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ __xmclTransportType: 'undefined' }))
    const result = await createHttpInvoke({ fetch: send })(operation(channel, args), 'r3', new AbortController().signal)
    expect(send.mock.calls[0][0]).toBe('/api/ellan/transport/' + channel)
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toEqual({ rendererId: 'r3', args })
    expect(result).toEqual({ __xmclTransportType: 'undefined' })
  })

  it('encodes routing segments without touching the payload', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(null))
    await createHttpInvoke({ fetch: send })(operation('service-call', ['Service/key', 'method ?#', 'http://launcher/resource']), 'r', new AbortController().signal)
    expect(send.mock.calls[0][0]).toBe('/api/ellan/services/Service%2Fkey/method%20%3F%23')
    expect(JSON.parse(send.mock.calls[0][1]!.body as string).args).toEqual(['http://launcher/resource'])
  })

  it('preserves successful service error envelopes for the original bridge to reject', async () => {
    const envelope = { error: { name: 'LaunchError', type: 'launchBlocked', message: 'Blocked', data: { __xmclTransportType: 'bytes', value: 'AA==' } } }
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(envelope))
    expect(await createHttpInvoke({ fetch: send })(operation('service-call', ['LaunchService', 'launch']), 'r', new AbortController().signal)).toEqual(envelope)
  })

  it('preserves structured HTTP errors instead of succeeding for unknown operations', async () => {
    const body = { name: 'FeatureError', code: 'PLUGIN_UNAVAILABLE', message: 'Unavailable capability', detail: { operation: 'unknown' } }
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status: 503 }))
    await expect(createHttpInvoke({ fetch: send })(operation('unknown'), 'r', new AbortController().signal)).rejects.toMatchObject({
      name: 'FeatureError', message: body.message, code: body.code, status: 503, detail: body.detail, body,
    })
    expect(send.mock.calls[0][0]).toBe('/api/ellan/transport/unknown')
  })

  it('retains nested HTTP failure details and the actual status', async () => {
    const body = { error: { name: 'DeniedError', code: 'DENIED', message: 'Denied', status: 999, detail: { scope: 'window' } } }
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json(body, { status: 403 }))
    await expect(createHttpInvoke({ fetch: send })(operation('window.control'), 'r', new AbortController().signal)).rejects.toMatchObject({
      name: 'DeniedError', code: 'DENIED', message: 'Denied', status: 403, body, detail: body.error.detail,
    })
  })

  it.each([['', 200, 'INVALID_RESPONSE', 502], ['not JSON', 200, 'INVALID_RESPONSE', 502], ['not JSON', 503, 'HTTP_ERROR', 503]] as const)('rejects malformed response %s (%i)', async (text, status, code, errorStatus) => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(text, { status }))
    await expect(createHttpInvoke({ fetch: send })(operation('task-poll'), 'r', new AbortController().signal)).rejects.toMatchObject({ code, status: errorStatus, body: text })
  })

  it.each([['service-call', []], ['service-call', ['BaseService']], ['service-call-traced', [{ traceparent: 'trace' }, 'BaseService']], ['service-call', ['..', 'getSettings']], ['', []]] as [string, unknown[]][])('rejects malformed routing without a request: %s %j', async (channel, args) => {
    const send = vi.fn<typeof fetch>()
    await expect(createHttpInvoke({ fetch: send })(operation(channel, args), 'r', new AbortController().signal)).rejects.toBeInstanceOf(EllanHttpError)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not start a request after its original scope has aborted', async () => {
    const controller = new AbortController(), reason = new Error('Renderer disposed')
    controller.abort(reason)
    const send = vi.fn<typeof fetch>()
    await expect(createHttpInvoke({ fetch: send })(operation('task-poll'), 'r', controller.signal)).rejects.toBe(reason)
    expect(send).not.toHaveBeenCalled()
  })

  it('does not wrap fetch or body-read abort failures', async () => {
    const controller = new AbortController(), reason = new DOMException('Disposed', 'AbortError')
    const send = vi.fn<typeof fetch>().mockImplementation(async (_path, init) => {
      expect(init?.signal).toBe(controller.signal)
      return await new Promise<Response>((_resolve, reject) => controller.signal.addEventListener('abort', () => reject(controller.signal.reason), { once: true }))
    })
    const pending = createHttpInvoke({ fetch: send })(operation('task-poll'), 'r', controller.signal)
    const rejected = expect(pending).rejects.toBe(reason)
    controller.abort(reason)
    await rejected
  })

  it('checks cancellation again after reading the response', async () => {
    const controller = new AbortController(), reason = new Error('Disposed during response')
    const send = vi.fn<typeof fetch>().mockResolvedValue({ ok: true, status: 200, text: async () => { controller.abort(reason); return '{}' } } as Response)
    await expect(createHttpInvoke({ fetch: send })(operation('task-poll'), 'r', controller.signal)).rejects.toBe(reason)
  })

  it('keeps structured errors through the unchanged framing provider', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ name: 'FeatureError', code: 'PLUGIN_UNAVAILABLE', message: 'Unavailable' }, { status: 503 }))
    const provider = createVirtualDeskGap({ invoke: createHttpInvoke({ fetch: send }), subscribe: () => () => {} })
    const channel = provider.createChannel(), writer = channel.writable.getWriter(), reader = channel.readable.getReader()
    try {
      await writer.write(frame({ type: 'connect', rendererId: 'r-original' }))
      await writer.write(frame(operation('unknown')))
      expect(decode((await reader.read()).value!)).toEqual({ type: 'response', id: 7, error: { name: 'FeatureError', code: 'PLUGIN_UNAVAILABLE', message: 'Unavailable', status: 503 } })
    } finally { writer.releaseLock(); reader.releaseLock(); provider.dispose() }
  })
})

describe('Ellan-only native event subscription', () => {
  it('uses main-owned event metadata on custom-scheme main documents', () => {
    expect(ellanWebSocketUrl(host({ location: { protocol: 'rhine-app:', host: 'app' }, rhineDesktop: { streamBaseUrl: 'http://127.0.0.1:23456' } }))).toBe('ws://127.0.0.1:23456/ws')
  })
  it('uses same-origin parent metadata in an iframe instead of guessing the custom scheme host', () => {
    const parent = host({ rhineDesktop: { streamBaseUrl: 'http://127.0.0.1:34567' } })
    expect(ellanWebSocketUrl(host({ location: { protocol: 'rhine-app:', host: 'app' }, parent }))).toBe('ws://127.0.0.1:34567/ws')
  })
  it('keeps browser HTTPS on WSS and ignores obsolete API metadata', () => {
    expect(ellanWebSocketUrl(host({ location: { protocol: 'https:', host: 'launcher.example:443' }, rhineDesktop: { apiBase: 'http://127.0.0.1:1234' } }))).toBe('wss://launcher.example/ws')
  })
  it('rejects custom-scheme documents without explicit event metadata', () => {
    expect(() => ellanWebSocketUrl(host({ location: { protocol: 'rhine-app:', host: 'app' } }))).toThrow('main/parent rhineDesktop.streamBaseUrl')
  })
  it('does not read an inaccessible cross-origin parent', () => {
    const parent = Object.defineProperty({}, 'rhineDesktop', { get() { throw new DOMException('Blocked', 'SecurityError') } })
    expect(ellanWebSocketUrl(host({ parent }))).toBe('ws://localhost:19876/ws')
    expect(() => ellanWebSocketUrl(host({ parent, location: { protocol: 'rhine-app:', host: 'app' } }))).toThrow('streamBaseUrl')
  })
  it.each(['https://attacker.invalid', 'http://user@127.0.0.1:1234', 'http://127.0.0.1', 'http://localhost:1234', 'http://127.0.0.1:1234/other', 'http://127.0.0.1:1234?other', 'http://127.0.0.1:1234#other', 'invalid'])('rejects invalid main-owned event metadata: %s', streamBaseUrl => {
    expect(() => ellanWebSocketUrl(host({ rhineDesktop: { streamBaseUrl } }))).toThrow('Invalid Ellan desktop event origin')
  })
  it('forwards only type:ellan channel,args as unchanged original arrays', () => {
    const listener = vi.fn(), unsubscribe = createEllanEventSubscribe(host())(listener)
    const socket = FakeSocket.instances[0]
    const args = ['settings-1', 'localeSet', { __xmclTransportType: 'undefined' }]
    try {
      for (const value of [{ type: 'bootstrap', bootstrap: {} }, { type: 'plugins', plugins: [] }, { type: 'task', channel: 'commit', args },
        { type: 'ellan', channel: 'commit', args: {} }, { type: 'ellan', args }, { type: 'ellan', channel: '', args }, ['commit', ...args], null]) socket.message(JSON.stringify(value))
      socket.message('not JSON'); socket.message(new Uint8Array([1, 2]))
      expect(listener).not.toHaveBeenCalled()
      socket.message(JSON.stringify({ type: 'ellan', channel: 'commit', args }))
      expect(listener).toHaveBeenCalledExactlyOnceWith(['commit', ...args])
      expect(decodeEllanEvent(JSON.stringify({ type: 'ellan', channel: 'commit', args }))).toEqual(['commit', ...args])
    } finally { unsubscribe() }
    expect(socket.close).toHaveBeenCalledOnce()
    socket.message(JSON.stringify({ type: 'ellan', channel: 'commit', args }))
    expect(listener).toHaveBeenCalledOnce()
  })
  it('reconnects after loss and cancels pending retries on disposal', () => {
    vi.useFakeTimers()
    const listener = vi.fn(), unsubscribe = createEllanEventSubscribe(host())(listener)
    FakeSocket.instances[0].dispatchEvent(new Event('close'))
    vi.advanceTimersByTime(250)
    expect(FakeSocket.instances).toHaveLength(2)
    FakeSocket.instances[1].dispatchEvent(new Event('open'))
    FakeSocket.instances[1].dispatchEvent(new Event('close'))
    unsubscribe(); unsubscribe()
    vi.advanceTimersByTime(30_000)
    expect(FakeSocket.instances).toHaveLength(2)
    expect(vi.getTimerCount()).toBe(0)
  })
})

describe('blocking virtual provider installation', () => {
  it('installs only window.deskgap synchronously and forbids same-realm remount', () => {
    const target = host(), provider = installEllanTransport(target)
    expect(target.deskgap).toBe(provider)
    expect(Object.keys(target)).not.toContain('serviceChannels')
    expect(() => installEllanTransport(target)).toThrow('replace the renderer document')
    provider.dispose(); provider.dispose()
    expect(target.deskgap).toBe(provider)
    expect(() => installEllanTransport(target)).toThrow('replace the renderer document')
    expect(FakeSocket.instances[0].close).toHaveBeenCalledOnce()
  })
  it('passes through explicit native file-drop subscriptions and releases them on pagehide', () => {
    const off = vi.fn(), onFilesDropped = vi.fn(() => off), listener = vi.fn()
    const target = host({ parent: host({ rhineDesktop: { streamBaseUrl: 'http://127.0.0.1:1234', onFilesDropped } }) })
    const provider = installEllanTransport(target)
    provider.onFilesDropped(listener)
    expect(onFilesDropped).toHaveBeenCalledExactlyOnceWith(listener)
    target.dispatchEvent(new Event('pagehide'))
    provider.dispose()
    expect(off).toHaveBeenCalledOnce()
    expect(FakeSocket.instances[0].close).toHaveBeenCalledOnce()
    expect(() => provider.createChannel()).toThrow('disposed')
  })
  it('aborts outstanding HTTP operations and closes event streams on pagehide', async () => {
    let pendingSignal: AbortSignal | undefined
    const send = vi.fn<typeof fetch>().mockImplementation(async (path, init) => {
      if (path === '/api/ellan/transport/release-renderer') return Response.json({ ok: true })
      const signal = init!.signal as AbortSignal
      pendingSignal = signal
      return await new Promise<Response>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason), { once: true }))
    })
    const target = host({ fetch: send }), provider = installEllanTransport(target)
    const channel = provider.createChannel(), writer = channel.writable.getWriter(), reader = channel.readable.getReader()
    try {
      await writer.write(frame({ type: 'connect', rendererId: 'r-owned' }))
      await writer.write(frame(operation('task-poll')))
      expect(send.mock.calls[0][0]).toBe('/api/ellan/transport/task-poll')
      target.dispatchEvent(new Event('pagehide'))
      expect(pendingSignal?.aborted).toBe(true)
      expect(send.mock.calls.some(([path, init]) => path === '/api/ellan/transport/release-renderer' && init?.keepalive === true)).toBe(true)
      expect((await reader.read()).done).toBe(true)
      expect(FakeSocket.instances[0].close).toHaveBeenCalledOnce()
    } finally { writer.releaseLock(); reader.releaseLock(); provider.dispose() }
  })
})

describe('original renderer assembly', () => {
  it('prepends blocking virtual shim then original DeskGap IIFE before original module without replacing launcher URLs', () => {
    const original = '<!DOCTYPE html><html><head><script src="http://launcher/flights"></script><script type="module" crossorigin src="./assets/original.js"></script></head><body><img src="http://launcher/image"><script>new URL("http://launcher/resource")</script></body></html>'
    const assembled = prependBridgeScripts(original)
    const scripts = assembled.match(/<script\b[^>]*>/g)!
    expect(scripts.slice(0, 4)).toEqual(['<script src="./compat/virtual-deskgap.js">', '<script src="./compat/deskgap-browser.js">', '<script src="http://launcher/flights">', '<script type="module" crossorigin src="./assets/original.js">'])
    const insertion = ['', '    <!-- Rhine virtual transport, then unchanged DeskGap bridge. -->', '    <script src="./compat/virtual-deskgap.js"></script>', '    <script src="./compat/deskgap-browser.js"></script>'].join('\n')
    expect(assembled.replace(insertion, '')).toBe(original)
    expect(assembled).toContain('new URL("http://launcher/resource")')
  })
  it('rejects HTML without original renderer structure or already-adapted input', () => {
    expect(() => prependBridgeScripts('<head></head>')).toThrow('renderer module')
    expect(() => prependBridgeScripts('<script type="module"></script>')).toThrow('head')
    expect(() => prependBridgeScripts(prependBridgeScripts('<head><script type="module" src="./entry.js"></script></head>'))).toThrow('dist/original')
  })
})
