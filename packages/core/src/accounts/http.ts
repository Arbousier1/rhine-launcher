import { AccountError, throwIfAborted } from './errors.ts'

export const ACCOUNT_HTTP_TIMEOUT_MS = 20_000
export const ACCOUNT_HTTP_ATTEMPTS = 3
export const FORM_HEADERS = { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' }
export const JSON_HEADERS = { 'content-type': 'application/json', accept: 'application/json' }

export function formEncode(values: Record<string, string>): string {
  return new URLSearchParams(values).toString()
}

/** Retry transport/5xx failures, but preserve OAuth 400 responses and their real codes. */
export async function requestJson<T>(url: string, init: RequestInit, label: string, signal?: AbortSignal): Promise<{ status: number; body?: T }> {
  for (let attempt = 0; attempt < ACCOUNT_HTTP_ATTEMPTS; attempt++) {
    throwIfAborted(signal)
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    signal?.addEventListener('abort', onAbort, { once: true })
    const timer = setTimeout(() => controller.abort(), ACCOUNT_HTTP_TIMEOUT_MS)
    let retry = false
    try {
      // Redirecting credential-bearing requests to another host is never allowed.
      const response = await fetch(url, { ...init, redirect: 'error', signal: controller.signal })
      const text = await response.text()
      throwIfAborted(signal)
      if (text.length > 1_048_576) throw new AccountError(label + '返回的数据过大', 'INVALID_RESPONSE', { status: 502 })
      let body: T | undefined
      if (text.trim()) {
        try { body = JSON.parse(text) as T } catch {
          if (response.status < 500) throw new AccountError(label + '返回的不是有效 JSON', 'INVALID_RESPONSE', { status: 502 })
        }
      }
      if (response.status >= 500) {
        if (attempt + 1 === ACCOUNT_HTTP_ATTEMPTS) throw new AccountError(label + '服务暂不可用（HTTP ' + response.status + '）', 'UPSTREAM_UNAVAILABLE', { status: 502 })
        retry = true
      } else return { status: response.status, body }
    } catch (error) {
      throwIfAborted(signal)
      if (error instanceof AccountError) throw error
      if (attempt + 1 === ACCOUNT_HTTP_ATTEMPTS) {
        // Provider errors can echo credentials; do not surface raw network error text.
        throw new AccountError(label + '失败，请检查网络连接或稍后重试', 'NETWORK_ERROR', { status: 502 })
      }
      retry = true
    } finally {
      clearTimeout(timer)
      signal?.removeEventListener('abort', onAbort)
    }
    if (retry) await abortableDelay(500 * 2 ** attempt, signal)
  }
  throw new AccountError(label + '失败', 'NETWORK_ERROR', { status: 502 })
}

export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  return new Promise((resolve, reject) => {
    const done = () => { signal?.removeEventListener('abort', cancel); resolve() }
    const timer = setTimeout(done, ms)
    const cancel = () => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', cancel)
      reject(new AccountError('认证操作已取消', 'REQUEST_CANCELLED', { status: 409 }))
    }
    signal?.addEventListener('abort', cancel, { once: true })
  })
}

export async function readAccountRequest(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (!text.trim()) return {}
  if (text.length > 65_536) throw new AccountError('账号请求过大', 'INVALID_REQUEST')
  let body: unknown
  try { body = JSON.parse(text) } catch { throw new AccountError('账号请求必须为有效 JSON', 'INVALID_REQUEST') }
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new AccountError('账号请求必须为 JSON 对象', 'INVALID_REQUEST')
  return body as Record<string, unknown>
}

export function requestString(body: Record<string, unknown>, key: string, optional = false): string | undefined {
  const value = body[key]
  if (value === undefined && optional) return undefined
  if (typeof value !== 'string' || !value.trim() || value.length > 4096) throw new AccountError('请求字段无效：' + key, 'INVALID_REQUEST')
  return value
}
