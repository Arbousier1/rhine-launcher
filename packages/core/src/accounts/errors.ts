/** Safe authentication metadata; never includes request bodies or credentials. */
export const AUTHENTICATION_STAGES = ['microsoft-oauth', 'xbox-live', 'xsts', 'minecraft-login', 'minecraft-profile'] as const
export type AuthenticationStage = typeof AUTHENTICATION_STAGES[number]
export interface AuthenticationDiagnostic {
  stage: AuthenticationStage
  upstreamStatus?: number
  providerCode?: 'ForbiddenOperationException' | 'UnauthorizedOperationException' | 'INVALID_APP_REGISTRATION' | 'TooManyRequestsException'
}
export interface AccountErrorOptions {
  status?: number
  retryAfterMs?: number
  intervalMs?: number
  flowId?: string
  diagnostic?: AuthenticationDiagnostic
}

/** Stable errors shared by account actions; never include request bodies or credentials. */
export class AccountError extends Error {
  readonly code: string
  readonly status: number
  readonly statusCode: number
  readonly retryAfterMs?: number
  readonly intervalMs?: number
  readonly flowId?: string
  readonly diagnostic?: AuthenticationDiagnostic

  constructor(message: string, code = 'ACCOUNT_ERROR', options: AccountErrorOptions = {}) {
    super(message)
    this.name = 'AccountError'
    this.code = code
    this.status = options.status ?? (code === 'ACCOUNT_NOT_FOUND' ? 404 : code === 'NETWORK_ERROR' ? 502 : 400)
    this.statusCode = this.status
    this.retryAfterMs = options.retryAfterMs
    this.intervalMs = options.intervalMs
    this.flowId = options.flowId
    this.diagnostic = options.diagnostic
  }
}

export function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted) throw new AccountError('认证操作已取消', 'REQUEST_CANCELLED', { status: 409 })
}
