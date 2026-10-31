/**
 * The single entry point every *.plugin.ts(x) file uses.
 *
 * Validation mirrors @rhine/plugin-api: a lowercase dotted id, exactly one
 * capability (always equal to the id) and exactly one contribution. Batch
 * registries are rejected outright so "one plugin, many features" cannot creep
 * back in through a convenience field.
 */
import { WebFeatureError } from './types.ts'
import type { WebFeature, WebFeatureKind } from './types.ts'

export interface DefineFeatureOptions<P> extends Omit<WebFeature<P>, 'capability'> {
  /** Optional because it normally equals `id`; a mismatch is rejected. */
  capability?: string
}

const KINDS: readonly WebFeatureKind[] = ['view', 'motion', 'slot', 'effect']
const ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/
const FORBIDDEN_KEYS = ['capabilities', 'features', 'routes', 'plugins'] as const

export function defineFeature<P = Record<string, unknown>>(
  options: DefineFeatureOptions<P>,
): WebFeature<P> {
  const id = options.id?.trim()
  if (!id) throw new WebFeatureError('INVALID_PLUGIN', 'a feature needs a non-empty id')
  if (!ID_PATTERN.test(id)) {
    throw new WebFeatureError('INVALID_PLUGIN', `"${id}" is not a lowercase dotted feature id`)
  }

  const capability = (options.capability ?? id).trim()
  if (capability !== id) {
    throw new WebFeatureError(
      'MULTIPLE_CAPABILITIES',
      `capability "${capability}" must equal id "${id}" (one feature, one capability)`,
    )
  }
  const raw = options as unknown as Record<string, unknown>
  for (const key of FORBIDDEN_KEYS) {
    if (key in raw) {
      throw new WebFeatureError('MULTIPLE_CAPABILITIES', `${id} cannot batch-register through "${key}"`)
    }
  }
  for (const dep of [...(options.depends ?? []), ...(options.optionalDepends ?? [])]) {
    if (typeof dep !== 'string' || !dep || dep === id) {
      throw new WebFeatureError('INVALID_PLUGIN', `${id} declares an invalid dependency "${String(dep)}"`)
    }
  }
  if (!options.title?.trim()) throw new WebFeatureError('INVALID_PLUGIN', `${id} needs a title`)
  if (!KINDS.includes(options.kind)) {
    throw new WebFeatureError('INVALID_PLUGIN', `${id} has unknown kind "${String(options.kind)}"`)
  }
  if (options.kind === 'view' && !options.route?.path) {
    throw new WebFeatureError('INVALID_PLUGIN', `view ${id} needs a route`)
  }
  if ((options.kind === 'motion' || options.kind === 'slot') && !options.slot) {
    throw new WebFeatureError('INVALID_PLUGIN', `${options.kind} ${id} needs a slot`)
  }
  if (options.kind !== 'view' && !options.render && !options.setup) {
    throw new WebFeatureError('INVALID_PLUGIN', `${id} contributes nothing (no render, no setup)`)
  }

  return Object.freeze({
    ...options,
    id,
    capability,
    depends: options.depends ? Object.freeze([...new Set(options.depends)]) : undefined,
    optionalDepends: options.optionalDepends
      ? Object.freeze([...new Set(options.optionalDepends)])
      : undefined,
  }) as WebFeature<P>
}
