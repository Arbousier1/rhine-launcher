import type { OriginalInvoke, VirtualTransportOptions } from './virtual-deskgap.ts'

export interface HttpInvokeOptions {
  fetch?: typeof fetch
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined
}

/** HTTP failures are distinct from the original bridge's successful service envelopes. */
export class EllanHttpError extends Error {
  readonly code: string
  readonly status: number
  readonly body: unknown
  readonly detail: unknown

  constructor(status: number, body: unknown, code = 'HTTP_ERROR', message = 'Ellan request failed: ' + status) {
    const outer = record(body)
    const source = record(outer?.error) ?? outer
    super(typeof source?.message === 'string' ? source.message : message)
    this.name = typeof source?.name === 'string' ? source.name : 'EllanHttpError'
    this.code = typeof source?.code === 'string' ? source.code : code
    this.status = status
    this.body = body
    this.detail = source?.detail
  }
}

function segment(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value || value === '.' || value === '..') {
    throw new EllanHttpError(400, { code: 'VALIDATION_ERROR', message: 'Invalid original ' + label })
  }
  return encodeURIComponent(value)
}

function request(message: OriginalInvoke, rendererId: string) {
  if (message.type !== 'invoke' || !Array.isArray(message.args) || typeof rendererId !== 'string' || !rendererId) {
    throw new EllanHttpError(400, { code: 'VALIDATION_ERROR', message: 'Invalid original invocation' })
  }
  if (message.channel === 'service-call' || message.channel === 'service-call-traced') {
    // The original callWithTrace signature puts the trace BEFORE the service key.
    const offset = message.channel === 'service-call-traced' ? 1 : 0
    const service = segment(message.args[offset], 'service key')
    const method = segment(message.args[offset + 1], 'service method')
    return {
      path: '/api/ellan/services/' + service + '/' + method,
      body: { rendererId, args: message.args.slice(offset + 2), traceContext: offset ? message.args[0] : undefined },
    }
  }
  // Unknown operations still reach the registry and its structured error path.
  return { path: '/api/ellan/transport/' + segment(message.channel, 'transport channel'), body: { rendererId, args: message.args } }
}

/** Move already-encoded transport values over same-origin HTTP, without hydrating or unwrapping them. */
export function createHttpInvoke(options: HttpInvokeOptions = {}): VirtualTransportOptions['invoke'] {
  const send = options.fetch ?? globalThis.fetch.bind(globalThis)
  return async (message, rendererId, signal) => {
    signal.throwIfAborted()
    const { path, body } = request(message, rendererId)
    const response = await send(path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body), signal,
    })
    const text = await response.text()
    signal.throwIfAborted()
    let result: unknown
    try { result = JSON.parse(text) } catch {
      if (!response.ok) throw new EllanHttpError(response.status, text)
      throw new EllanHttpError(502, text, 'INVALID_RESPONSE', 'Ellan returned an invalid JSON response')
    }
    if (!response.ok) throw new EllanHttpError(response.status, result)
    // In particular, { result, error } and __xmclTransportType / __state__ belong
    // to the original DeskGap bridge. Even a service error envelope is raw data here.
    return result
  }
}
