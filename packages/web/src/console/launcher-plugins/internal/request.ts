import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import { launcherState, type LauncherAction, type LauncherState } from '../../launcher-state'

export function assertActive(signal: AbortSignal): void {
  if (signal.aborted) throw new FeatureError('PLUGIN_CANCELLED', '操作已取消', 409)
}
/** Also settles promptly when a transport implementation ignores its AbortSignal. */
export function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new FeatureError('PLUGIN_CANCELLED', '操作已取消', 409))
    if (signal.aborted) { abort(); void work.catch(() => {}); return }
    signal.addEventListener('abort', abort, { once: true })
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort)).catch(() => {})
  })
}
/** Internal transport algorithm, not a public multi-service capability. */
export async function request(env: FeatureEnvironment, path: string, init: RequestInit = {}): Promise<unknown> {
  assertActive(env.signal)
  return abortable((async () => {
    const headers = new Headers(init.headers)
    if (init.body !== undefined) headers.set('content-type', 'application/json')
    const response = await fetch(path, { ...init, headers, signal: env.signal })
    const raw = await response.text()
    assertActive(env.signal)
    let body: unknown
    try { body = raw ? JSON.parse(raw) : undefined } catch { /* HTTP errors retain their status even for HTML responses. */ }
    const detail = body !== null && typeof body === 'object' && !Array.isArray(body) ? body as Record<string, unknown> : {}
    if (!response.ok) throw new FeatureError(typeof detail.code === 'string' && detail.code ? detail.code : 'HTTP_' + response.status, typeof detail.message === 'string' && detail.message ? detail.message : '请求失败（HTTP ' + response.status + '）', response.status)
    if (body === undefined) throw new FeatureError('INVALID_RESPONSE', '后端返回了空白或无效 JSON（UNKNOWN）', 502)
    return body
  })(), env.signal)
}
export async function action<T>(env: FeatureEnvironment, kind: LauncherAction, instanceId: string | undefined, run: (state: LauncherState) => Promise<T>): Promise<T> {
  const state = launcherState(env)
  const token = state.startAction(kind, instanceId)
  try {
    assertActive(env.signal)
    const result = await abortable(run(state), env.signal)
    assertActive(env.signal)
    state.finishAction(token)
    return result
  } catch (error) { state.finishAction(token, error); throw error }
}
