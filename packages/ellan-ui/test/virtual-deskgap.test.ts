import { describe, expect, it, vi } from 'vitest'
import { createVirtualDeskGap, type OriginalInvoke } from '../src/virtual-deskgap.ts'
import { TransportFrameDecoder } from '../vendor/deskgap/framing.ts'
function frame(value: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify(value)), result = new Uint8Array(4 + bytes.length)
  new DataView(result.buffer).setUint32(0, bytes.length)
  result.set(bytes, 4)
  return result
}
function decode(value: Uint8Array) {
  return JSON.parse(new TextDecoder().decode(new TransportFrameDecoder().push(value)[0]))
}
describe('original browser bridge virtual transport', () => {
  it('does not hold later operations behind a slow RPC', async () => {
    let complete: ((value: unknown) => void) | undefined
    const provider = createVirtualDeskGap({ invoke: message => message.id === 1
      ? new Promise(resolve => { complete = resolve }) : Promise.resolve({ result: 'fast' }), subscribe: () => () => {} })
    const channel = provider.createChannel(), writer = channel.writable.getWriter(), reader = channel.readable.getReader()
    try {
      await writer.write(frame({ type: 'connect', rendererId: 'r1' }))
      await writer.write(frame({ type: 'invoke', id: 1, channel: 'slow', args: [] }))
      await writer.write(frame({ type: 'invoke', id: 2, channel: 'fast', args: [] }))
      expect(decode((await reader.read()).value!)).toEqual({ type: 'response', id: 2, result: { result: 'fast' } })
      complete?.({ result: 'slow' })
      expect(decode((await reader.read()).value!)).toEqual({ type: 'response', id: 1, result: { result: 'slow' } })
    } finally { writer.releaseLock(); reader.releaseLock(); provider.dispose() }
  })
  it('preserves original service-call envelopes over split frames', async () => {
    const invoke = vi.fn(async (message: OriginalInvoke) => ({ result: { __state__: 'Settings', id: 'settings-1', locale: 'zh-CN' }, method: message.channel }))
    const provider = createVirtualDeskGap({ invoke, subscribe: () => () => {} })
    const channel = provider.createChannel(), writer = channel.writable.getWriter(), reader = channel.readable.getReader()
    try {
      await writer.write(frame({ type: 'connect', rendererId: 'original-renderer' }))
      const request = frame({ type: 'invoke', id: 7, channel: 'service-call', args: ['BaseService', 'getSettings'] })
      await writer.write(request.subarray(0, 3)); await writer.write(request.subarray(3))
      const result = await reader.read()
      expect(result.done).toBe(false)
      expect(decode(result.value!)).toEqual({ type: 'response', id: 7, result: { result: { __state__: 'Settings', id: 'settings-1', locale: 'zh-CN' }, method: 'service-call' } })
      expect(invoke).toHaveBeenCalledWith({ type: 'invoke', id: 7, channel: 'service-call', args: ['BaseService', 'getSettings'] }, 'original-renderer', expect.any(AbortSignal))
    } finally { writer.releaseLock(); reader.releaseLock(); provider.dispose() }
  })
  it('returns structured errors instead of pretending unsupported operations succeeded', async () => {
    const provider = createVirtualDeskGap({ invoke: async () => { throw Object.assign(new Error('Unavailable capability'), { code: 'PLUGIN_UNAVAILABLE', status: 503 }) }, subscribe: () => () => {} })
    const channel = provider.createChannel(), writer = channel.writable.getWriter(), reader = channel.readable.getReader()
    try {
      await writer.write(frame({ type: 'connect', rendererId: 'r1' }))
      await writer.write(frame({ type: 'invoke', id: 1, channel: 'unsupported', args: [] }))
      expect(decode((await reader.read()).value!)).toEqual({ type: 'response', id: 1, error: { name: 'Error', message: 'Unavailable capability', code: 'PLUGIN_UNAVAILABLE', status: 503 } })
    } finally { writer.releaseLock(); reader.releaseLock(); provider.dispose() }
  })
  it('forwards original event arrays and releases subscriptions on disposal', async () => {
    let emit: ((event: readonly unknown[]) => void) | undefined
    const off = vi.fn()
    const provider = createVirtualDeskGap({ invoke: async () => undefined, subscribe: listener => { emit = listener; return off } })
    const channel = provider.createChannel(), reader = channel.readable.getReader()
    emit?.(['commit', 'settings-1', 'localeSet', 'zh-CN'])
    expect(decode((await reader.read()).value!)).toEqual(['commit', 'settings-1', 'localeSet', 'zh-CN'])
    provider.dispose(); provider.dispose()
    expect(off).toHaveBeenCalledOnce()
    expect((await reader.read()).done).toBe(true)
    expect(() => provider.createChannel()).toThrow('disposed')
    reader.releaseLock()
  })
})
