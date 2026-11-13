import type { FeatureEnvironment } from '@rhine/plugin-api'
import { AccountError, AUTHENTICATION_STAGES, type AuthenticationDiagnostic } from './errors.ts'
import type { MicrosoftConfiguration } from './config.ts'
import { BUILTIN_MICROSOFT_APP } from './builtin-app.ts'

export interface MicrosoftFailureDiagnostic extends AuthenticationDiagnostic {
  occurredAt: string
  code: string
  application: 'builtin' | 'custom'
}
interface DiagnosticsState { lastFailure?: MicrosoftFailureDiagnostic }
const CODES = new Set([
  'MINECRAFT_APP_NOT_APPROVED', 'MINECRAFT_ACCESS_DENIED', 'MINECRAFT_IDENTITY_REJECTED',
  'MINECRAFT_RATE_LIMITED', 'MINECRAFT_INVALID_TOKEN_RESPONSE', 'MINECRAFT_LOGIN_FAILED',
  'XBL_FAILED', 'XSTS_FAILED', 'XSTS_IDENTITY_MISMATCH', 'PROFILE_NOT_FOUND', 'PROFILE_FAILED',
  'PROFILE_INVALID', 'PROFILE_MISMATCH', 'NETWORK_ERROR', 'UPSTREAM_UNAVAILABLE', 'INVALID_RESPONSE',
])
const PROVIDER_CODES = new Set(['ForbiddenOperationException', 'UnauthorizedOperationException', 'INVALID_APP_REGISTRATION', 'TooManyRequestsException'])
function state(env: FeatureEnvironment): DiagnosticsState {
  return env.state('accounts.microsoft.failure-diagnostic', () => ({} as DiagnosticsState))
}

/** Record only allowlisted metadata; no username, tokens, flow ids or provider messages. */
export function recordMicrosoftFailure(env: FeatureEnvironment, error: unknown, config: MicrosoftConfiguration): void {
  if (!(error instanceof AccountError) || !error.diagnostic || !CODES.has(error.code)) return
  const { stage, upstreamStatus, providerCode } = error.diagnostic
  if (!AUTHENTICATION_STAGES.includes(stage)) return
  const failure: MicrosoftFailureDiagnostic = {
    occurredAt: new Date().toISOString(), code: error.code, stage,
    application: config.clientId === BUILTIN_MICROSOFT_APP.clientId ? 'builtin' : 'custom',
  }
  if (Number.isInteger(upstreamStatus) && upstreamStatus! >= 100 && upstreamStatus! <= 599) failure.upstreamStatus = upstreamStatus
  if (providerCode && PROVIDER_CODES.has(providerCode)) failure.providerCode = providerCode
  state(env).lastFailure = failure
}
export function clearMicrosoftFailure(env: FeatureEnvironment): void { state(env).lastFailure = undefined }
/** Reading diagnostics never initiates an authentication or network request. */
export function microsoftFailureDiagnostic(env: FeatureEnvironment): { lastFailure: MicrosoftFailureDiagnostic | null } {
  const failure = state(env).lastFailure
  return { lastFailure: failure ? { ...failure } : null }
}
