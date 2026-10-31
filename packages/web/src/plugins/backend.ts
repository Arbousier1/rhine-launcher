/**
 * Page-local adapter for the backend feature manager.
 *
 * `packages/web/src/api/client.ts` is owned by the Lead, so this page talks to
 * the documented endpoints directly and keeps the typed surface here. The
 * server exposes one plugin per capability, so the adapter never batches:
 * one id, one enable/disable call.
 */

export interface BackendFeatureInfo {
  id: string
  title: string
  capability: string
  description?: string
  status: string
  depends?: string[]
}

export class BackendFeatureError extends Error {
  readonly status: number
  readonly unsupported: boolean

  constructor(message: string, status: number) {
    super(message)
    this.name = 'BackendFeatureError'
    this.status = status
    this.unsupported = status === 404 || status === 405 || status === 501
  }
}

function endpoint(path: string): string {
  const base = typeof window === 'undefined' ? '' : window.location.origin
  return base + path
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(endpoint(path), {
    headers: { 'content-type': 'application/json' },
    ...init,
  })
  const text = await response.text()
  let payload: unknown = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  if (!response.ok) {
    const message =
      payload && typeof payload === 'object' && 'message' in payload
        ? String((payload as { message: unknown }).message)
        : 'HTTP ' + response.status
    throw new BackendFeatureError(message, response.status)
  }
  return payload as T
}

function normalizeList(payload: unknown): BackendFeatureInfo[] {
  const raw = Array.isArray(payload)
    ? payload
    : payload && typeof payload === 'object'
      ? ((payload as { plugins?: unknown }).plugins ??
         (payload as { features?: unknown }).features ??
         (payload as { items?: unknown }).items)
      : null
  if (!Array.isArray(raw)) return []
  return raw
    .filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object')
    .map((item) => ({
      id: String(item.id ?? item.capability ?? ''),
      capability: String(item.capability ?? item.id ?? ''),
      title: String(item.title ?? item.id ?? ''),
      description: typeof item.description === 'string' ? item.description : undefined,
      status: String(item.status ?? (item.enabled === true ? 'enabled' : 'disabled')),
      depends: Array.isArray(item.depends) ? item.depends.map(String) : undefined,
    }))
    .filter((item) => item.id.length > 0)
}

export async function listBackendFeatures(): Promise<BackendFeatureInfo[]> {
  return normalizeList(await request<unknown>('/api/plugins'))
}

export async function setBackendFeatureEnabled(id: string, enabled: boolean): Promise<void> {
  const action = enabled ? 'enable' : 'disable'
  await request<unknown>('/api/plugins/' + encodeURIComponent(id) + '/' + action, {
    method: 'POST',
    body: JSON.stringify({ id }),
  })
}
