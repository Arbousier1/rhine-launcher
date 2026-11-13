import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RhPaths } from '../contracts.ts'
import type { Settings, TaskSnapshot } from '../types.ts'
import { FeatureError } from '@rhine/plugin-api'
import { type OriginalCall, text } from './feature.ts'
import { emitOriginal, findState, restoreState, store, dropState } from './state.ts'
export async function revalidate(input: OriginalCall, env: FeatureEnvironment) {
  const state = findState(env, input.args[0])
  emitOriginal(env, 'state-validating', [{ id: state.id, semaphore: 1 }])
  const previous = structuredClone(state.snapshot)
  try {
    await env.use(state.feature, { rendererId: input.rendererId, args: state.args })
    restoreState(env, state, previous)
  } finally { emitOriginal(env, 'state-validating', [{ id: state.id, semaphore: 0 }]) }
}
export function unref(input: OriginalCall, env: FeatureEnvironment) {
  const id = text(input.args[0], 'state id'), cache = store(env), key = cache.ids.get(id)
  if (key) {
    const state = cache.states.get(key)
    state?.renderers.delete(input.rendererId)
    if (!state || state.renderers.size === 0) dropState(env,key)
  }
}
export async function tasks(_input: OriginalCall, env: FeatureEnvironment) {
  const values = await env.use<Promise<TaskSnapshot[]>>('task.list')
  return values.map(t => ({ id: t.id, key: t.id, type: t.kind, substate: {type:t.progress.stage,title:t.title,message:t.progress.message},
    state: t.status === 'succeeded' ? 2 : t.status === 'failed' ? 3 : t.status === 'cancelled' ? 1 : 0,
    progress: { total: t.progress.total, progress: t.progress.current },
    error: t.error ? { message: t.error } : undefined,
  }))
}
export async function taskCheck(input: OriginalCall, env: FeatureEnvironment) {
  const values = await env.use<Promise<TaskSnapshot[]>>('task.list')
  return values.some(t => t.status === 'queued' || t.status === 'running')
}
export async function taskClear(_input: OriginalCall, env: FeatureEnvironment) { await env.use('task.clear') }
export async function taskOperation(input: OriginalCall, env: FeatureEnvironment) {
  const operation = input.args[0] as { type?: string; id?: string }
  if (!operation || operation.type !== 'cancel') throw new FeatureError('OPERATION_UNAVAILABLE', 'Task operation is unavailable', 503)
  await env.use('task.cancel', { id: text(operation.id, 'task id') })
}
export async function preset(_input: OriginalCall, env: FeatureEnvironment) {
  const paths = env.use<RhPaths>('paths.get'), settings = await env.use<Promise<Settings>>('settings.get')
  return { minecraftPath: paths.root, defaultPath: paths.root, locale: settings.language, drives: [] }
}
export async function telemetry(_input: OriginalCall, env: FeatureEnvironment) {
  // This host does not enable the upstream telemetry provider.
  const state = store(env).states.get('Settings')
  if (state?.snapshot.disableTelemetry !== true) throw new FeatureError('TELEMETRY_DISABLED', 'Telemetry is not configured', 503)
}
