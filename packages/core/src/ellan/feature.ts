import { defineFeature, FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import { withOriginalCaller } from './caller.ts'
export interface OriginalCall { rendererId: string; args: unknown[]; traceContext?: unknown }
export function record(value: unknown, label = 'object'): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Expected ' + label, 400)
  return value as Record<string, unknown>
}
export function text(value: unknown, label = 'text'): string {
  if (typeof value !== 'string' || !value || value.length > 4096) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Expected ' + label, 400)
  return value
}
export function decodeValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(decodeValue)
  if (!value || typeof value !== 'object') return value
  const object = value as Record<string, unknown>
  if (object.__xmclTransportType === 'undefined') return undefined
  if (object.__xmclTransportType === 'bigint') return BigInt(text(object.value))
  if (object.__xmclTransportType === 'bytes') return new Uint8Array(Buffer.from(text(object.value), 'base64'))
  return Object.fromEntries(Object.entries(object).map(([key, item]) => [key, decodeValue(item)]))
}
async function decode(request: Request): Promise<OriginalCall> {
  const body = record(await request.json())
  if (!Array.isArray(body.args)) throw new FeatureError('INVALID_ORIGINAL_CALL', 'Expected operation arguments', 400)
  return { rendererId: text(body.rendererId, 'renderer id'), args: body.args.map(decodeValue), traceContext: body.traceContext }
}
/** A factory creates exactly one descriptor for one original operation. */
export function serviceFeature(id: string, service: string, method: string, depends: readonly string[], execute: (input: OriginalCall, env: FeatureEnvironment) => Promise<unknown> | unknown, background?: {kind:string;title:string;waitForResult?:boolean}) {
  return defineFeature<OriginalCall, Promise<{ result: unknown }>>({
    id, capability: id, title: service + '.' + method, depends,
    http: { method: 'POST', path: '/api/ellan/services/' + service + '/' + method, decode, background },
    async execute(input, env) { return withOriginalCaller(input.rendererId, async () => ({ result: await execute(input, env) })) },
  })
}
export function transportFeature(id: string, channel: string, depends: readonly string[], execute: (input: OriginalCall, env: FeatureEnvironment) => Promise<unknown> | unknown) {
  return defineFeature<OriginalCall, Promise<unknown>>({
    id, capability: id, title: channel, depends,
    http: { method: 'POST', path: '/api/ellan/transport/' + channel, decode },
    async execute(input, env) { return withOriginalCaller(input.rendererId, () => execute(input, env)) },
  })
}
