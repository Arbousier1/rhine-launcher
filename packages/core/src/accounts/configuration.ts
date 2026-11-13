import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { Settings } from '../types.ts'
import { SECRET_ENV, envValue, resolveMicrosoftClientId, type SecretOrigin } from '../config/secrets.ts'
import { MICROSOFT_AUTHORITY, microsoftConfiguration, normalizeMicrosoftAuthority } from './config.ts'
import { BUILTIN_APP_OPT_OUT, builtinMicrosoftClientId } from './builtin-app.ts'
import { AccountError } from './errors.ts'

type MicrosoftSettings = Pick<Settings, 'microsoftClientId' | 'microsoftAuthority'>

/**
 * Public configuration metadata only.
 *
 * `source` explains where a syntactically valid app id came from. `builtin`
 * means this release carries the publisher's registration, NOT that Mojang has
 * approved its Minecraft API access or that an account owns the game. The id
 * itself is never returned — status stays metadata-only.
 */
export interface MicrosoftConfigurationStatus {
  configured: boolean
  source: SecretOrigin
  managed: boolean
  authority: string
  /** True when no user or environment value was needed. */
  builtin: boolean
  /** True when a distributor disabled the built-in identity. */
  optedOut: boolean
  reason?: string
  message?: string
}

export interface MicrosoftConfigureInput { clientId: string; authority?: string }

const INVALID_ENV_AUTHORITY = '环境变量 RHINE_MICROSOFT_AUTHORITY 无效，请联系发布方修正为 Microsoft HTTPS v2.0 authority 或移除该变量。'

function effectiveAuthority(settings: MicrosoftSettings): string {
  const value = envValue(SECRET_ENV.microsoftAuthority) ?? settings.microsoftAuthority
  return normalizeMicrosoftAuthority(typeof value === 'string' ? value.trim() || MICROSOFT_AUTHORITY : value ?? MICROSOFT_AUTHORITY)
}

function configurationMessage(error: AccountError, source: SecretOrigin): string {
  if (error.code === 'INVALID_CLIENT_ID' && source === 'env') {
    return '环境变量 RHINE_MICROSOFT_CLIENT_ID 不是有效的应用 ID（GUID），请联系发布方修正或移除后再使用微软登录设置。'
  }
  if (error.code === 'INVALID_AUTHORITY' && envValue(SECRET_ENV.microsoftAuthority)) return INVALID_ENV_AUTHORITY
  return error.message
}

/** Effective built-in identity for this process, honouring the opt-out. */
function builtinId(): string | undefined {
  return builtinMicrosoftClientId(SECRET_ENV.microsoftClientId)
}

/** True when `RHINE_MICROSOFT_CLIENT_ID=off` disabled the built-in identity. */
function builtinOptedOut(): boolean {
  return envValue(SECRET_ENV.microsoftClientId)?.toLowerCase() === BUILTIN_APP_OPT_OUT
}

export function microsoftConfigurationStatus(settings: MicrosoftSettings): MicrosoftConfigurationStatus {
  const resolved = resolveMicrosoftClientId(settings.microsoftClientId, builtinId())
  const source = resolved.origin
  const managed = source === 'env'
  const optedOut = builtinOptedOut()
  let authority = MICROSOFT_AUTHORITY
  let authorityError: AccountError | undefined
  // Even a missing/invalid ID must report a safe, effective authority, not raw settings.
  try { authority = effectiveAuthority(settings) }
  catch (error) {
    if (!(error instanceof AccountError)) throw error
    authorityError = error
  }
  try {
    const config = microsoftConfiguration({}, settings)
    return { configured: true, source, managed, builtin: source === 'builtin', optedOut, authority: config.authority }
  } catch (error) {
    // A malformed authority in an imported settings file may fail before .trim().
    const failure = error instanceof AccountError ? error : authorityError
    if (!failure) throw error
    let message = configurationMessage(failure, source)
    if (authorityError && envValue(SECRET_ENV.microsoftAuthority) && failure.code !== 'INVALID_AUTHORITY') {
      message += ' ' + INVALID_ENV_AUTHORITY
    }
    if (optedOut) message += ' 当前 RHINE_MICROSOFT_CLIENT_ID=off 已关闭内置应用身份。'
    return { configured: false, source, managed, builtin: false, optedOut, authority, reason: failure.code, message }
  }
}

function configurationInput(input: unknown): MicrosoftConfigureInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new AccountError('微软登录设置必须为 JSON 对象', 'INVALID_REQUEST')
  }
  if (Reflect.ownKeys(input).some(key => key !== 'clientId' && key !== 'authority')) {
    throw new AccountError('微软登录设置仅允许 clientId 和 authority 字段', 'INVALID_REQUEST')
  }
  const body = input as Record<string, unknown>
  if (!Object.hasOwn(body, 'clientId') || typeof body.clientId !== 'string' || body.clientId.length > 4096) {
    throw new AccountError('clientId 必须为应用 ID 字符串，可留空以清除本地配置', 'INVALID_REQUEST')
  }
  const authority = Object.hasOwn(body, 'authority') ? body.authority : undefined
  if (authority !== undefined && (typeof authority !== 'string' || authority.length > 4096)) {
    throw new AccountError('authority 必须为 Microsoft authority 字符串', 'INVALID_AUTHORITY')
  }
  return { clientId: body.clientId.trim(), authority }
}

/** Validate first, then persist only this operation's fields through settings.update. */
export async function configureMicrosoft(input: unknown, env: FeatureEnvironment): Promise<MicrosoftConfigurationStatus> {
  const body = configurationInput(input)
  const settings = env.use<Settings>('settings.get')
  const source = resolveMicrosoftClientId(settings.microsoftClientId, builtinId()).origin
  if (source === 'env') {
    throw new AccountError('微软登录由环境变量 RHINE_MICROSOFT_CLIENT_ID 管理，不能在此修改。请联系发布方修改或移除该变量后，再使用微软登录设置。', 'MICROSOFT_CONFIGURATION_MANAGED', { status: 409 })
  }

  const patch: MicrosoftSettings = { microsoftClientId: body.clientId }
  const authority = body.authority === undefined ? undefined : normalizeMicrosoftAuthority(body.authority)
  try {
    if (authority !== undefined) {
      const fromEnv = envValue(SECRET_ENV.microsoftAuthority)
      if (fromEnv) {
        if (authority !== normalizeMicrosoftAuthority(fromEnv)) {
          throw new AccountError('微软登录 authority 由环境变量 RHINE_MICROSOFT_AUTHORITY 管理，请联系发布方修改或移除该变量；也可省略 authority，仅修改应用 ID。', 'MICROSOFT_AUTHORITY_MANAGED', { status: 409 })
        }
        // Do not create a local shadow of an environment-managed authority.
      } else patch.microsoftAuthority = authority
    }
    if (body.clientId) {
      const candidate = { ...settings, ...patch }
      effectiveAuthority(candidate)
      microsoftConfiguration({}, candidate)
    }
    // Clearing an unmanaged ID is also allowed when the old configuration is
    // invalid; with a built-in identity the cleared state simply falls back to it.
  } catch (error) {
    if (!(error instanceof AccountError)) throw error
    throw new AccountError(configurationMessage(error, source), error.code, { status: error.status })
  }
  const updated = await env.use<Promise<Settings>>('settings.update', patch)
  return microsoftConfigurationStatus(updated)
}
