/** Stable errors shared by account actions; never include request bodies or credentials. */
export class AccountError extends Error {
  readonly code: string
  readonly status: number
  readonly statusCode: number
  readonly retryAfterMs?: number
  readonly intervalMs?: number
  readonly flowId?: string

  constructor(message: string, code = 'ACCOUNT_ERROR', options: { status?: number; retryAfterMs?: number; intervalMs?: number; flowId?: string } = {}) {
    super(message)
    this.name = 'AccountError'
    this.code = code
    this.status = options.status ?? (code === 'ACCOUNT_NOT_FOUND' ? 404 : code === 'NETWORK_ERROR' ? 502 : 400)
    this.statusCode = this.status
    this.retryAfterMs = options.retryAfterMs
    this.intervalMs = options.intervalMs
    this.flowId = options.flowId
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AccountError('认证操作已取消', 'REQUEST_CANCELLED', { status: 409 })
}
