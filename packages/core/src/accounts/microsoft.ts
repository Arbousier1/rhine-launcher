/**
 * Microsoft / Xbox Live authentication protocol helpers.
 *
 * Protocol chain: Microsoft OAuth -> Xbox Live user token -> XSTS token -> Minecraft
 * access token -> profile. Everything in this module is pure (payload builders
 * and response parsers) so the service only has to own HTTP and persistence.
 */
import type { Account, DeviceCodeFlow } from '../types.ts'
import { expandUuid } from './uuid.ts'

/** Compatibility export only. Rhine has no bundled OAuth app registration. Configure an owned/authorized client ID explicitly. */
export const MICROSOFT_CLIENT_ID = ''

/** OAuth scopes required for Xbox Live sign-in and token refresh. */
export const MICROSOFT_SCOPE = 'XboxLive.signin offline_access'

/** Device-code endpoint of the consumer tenant. */
export const MICROSOFT_DEVICE_CODE_URL =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/devicecode'

/** Token endpoint used for both polling and refreshing. */
export const MICROSOFT_TOKEN_URL =
  'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'

/** Xbox Live user authentication. */
export const XBOX_LIVE_AUTH_URL = 'https://user.auth.xboxlive.com/user/authenticate'

/** Xbox Security Token Service (XSTS) authorization. */
export const XSTS_AUTH_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'

/** Minecraft services login. */
export const MINECRAFT_LOGIN_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'

/** Minecraft profile lookup. */
export const MINECRAFT_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

/** Error code Microsoft returns while the user has not finished signing in. */
export const AUTHORIZATION_PENDING = 'authorization_pending'

/** Device-code response body. */
export interface DeviceCodeBody {
  user_code?: string
  device_code?: string
  verification_uri?: string
  verification_url?: string
  expires_in?: number
  interval?: number
  message?: string
}

/** Token endpoint response body (success or OAuth error). */
export interface TokenBody {
  access_token?: string
  refresh_token?: string
  expires_in?: number
  token_type?: string
  user_id?: string
  error?: string
  error_description?: string
  error_codes?: number[]
}

/** Parsed Microsoft tokens. */
export interface MicrosoftTokens {
  accessToken: string
  refreshToken?: string
  /** Lifetime in seconds. */
  expiresIn: number
  userId?: string
}

/** Response of the Xbox Live user/XSTS endpoints. */
export interface XboxAuthBody {
  Token?: string
  DisplayClaims?: { xui?: { uhs?: string; xid?: string }[] }
  Identity?: string
  XErr?: number
  Message?: string
}

/** Response of the Minecraft login endpoint. */
export interface MinecraftLoginBody {
  access_token?: string
  expires_in?: number
  username?: string
  token_type?: string
}

/** Response of the Minecraft profile endpoint. */
export interface MinecraftProfileBody {
  id?: string
  name?: string
  skins?: { id?: string; state?: string; url?: string; variant?: string }[]
  capes?: unknown[]
}

/** Convert a device-code response into the shared flow type. */
export function parseDeviceCode(body: DeviceCodeBody | undefined, now = Date.now()): DeviceCodeFlow | undefined {
  const userCode = body?.user_code?.trim()
  const deviceCode = body?.device_code?.trim()
  const verificationUri = (body?.verification_uri ?? body?.verification_url)?.trim()
  if (!userCode || !deviceCode || !verificationUri) return undefined
  const expiresIn = Number(body?.expires_in)
  const interval = Number(body?.interval)
  return {
    userCode,
    verificationUri,
    deviceCode,
    // Microsoft asks for a poll interval of at least five seconds by default.
    intervalMs: Math.max(1000, (Number.isFinite(interval) && interval > 0 ? interval : 5) * 1000),
    expiresAt: now + (Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 900) * 1000,
  }
}

/** Extract the OAuth error code of a failed token response. */
export function tokenErrorCode(body: TokenBody | undefined): string | undefined {
  const code = typeof body?.error === 'string' ? body.error.trim() : ''
  return code ? code : undefined
}

/** Extract a useful error description (falls back to the OAuth code). */
export function tokenErrorDetail(body: TokenBody | undefined): string {
  const description = body?.error_description?.trim()
  if (description) return description
  const code = tokenErrorCode(body)
  return code ? oauthErrorHint(code) : '微软返回了未知错误'
}

/** Parse a successful token response. */
export function parseTokenBody(body: TokenBody | undefined): MicrosoftTokens | undefined {
  const accessToken = body?.access_token?.trim()
  if (!accessToken) return undefined
  const expiresIn = Number(body?.expires_in)
  return {
    accessToken,
    refreshToken: body?.refresh_token?.trim() || undefined,
    expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : 86_400,
    userId: body?.user_id,
  }
}

/** Chinese explanation of a Microsoft OAuth error code. */
export function oauthErrorHint(code: string): string {
  switch (code) {
    case AUTHORIZATION_PENDING:
      return '授权尚未完成，请在浏览器中完成微软登录'
    case 'slow_down':
      return '轮询过于频繁，请稍后再试'
    case 'authorization_declined':
      return '用户拒绝了授权，请重新开始登录'
    case 'expired_token':
    case 'code_expired':
      return '设备码已过期，请重新开始登录'
    case 'bad_verification_code':
      return '设备码无效，请重新开始登录'
    case 'invalid_grant':
      return '授权已失效，请重新登录'
    case 'invalid_client':
      return '微软客户端 ID 无效或不在该 authority 下。请在设置 → 账号配置你自己的应用 client_id/authority，或向 /api/accounts/microsoft/start 提交 clientId/authority；启动器不会自动换用其他项目的应用。'
    case 'unauthorized_client':
      return '当前应用不允许使用设备码登录。请在应用注册中启用公共客户端流，并在设置 → 账号确认 client_id/authority；不会偷偷替换成其他项目的应用。'
    default:
      return '微软登录失败（' + code + '）'
  }
}

/** Chinese explanation of an XSTS 'XErr' code. */
export function xstsErrorHint(xerr: number | undefined): string {
  switch (xerr) {
    case 2148916233:
      return '该微软账号没有 Xbox Live 档案，请先在 xbox.com 创建'
    case 2148916235:
      return 'Xbox Live 在当前国家或地区不可用'
    case 2148916236:
    case 2148916237:
      return '该账号需要先在 xbox.com 完成成人身份验证'
    case 2148916238:
      return '该账号是受家庭组管理的未成年人账号，请先加入家庭组'
    default:
      return 'Xbox Live 授权失败，请确认该账号已购买 Minecraft'
  }
}

/** Xbox Live user authentication request body. */
export function xboxLivePayload(accessToken: string): Record<string, unknown> {
  return {
    Properties: {
      AuthMethod: 'RPS',
      SiteName: 'user.auth.xboxlive.com',
      RpsTicket: 'd=' + accessToken,
    },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  }
}

/** XSTS authorization request body. */
export function xstsPayload(xboxLiveToken: string): Record<string, unknown> {
  return {
    Properties: {
      SandboxId: 'RETAIL',
      UserTokens: [xboxLiveToken],
    },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  }
}

/** Minecraft login request body. */
export function minecraftLoginPayload(userHash: string, xstsToken: string): Record<string, unknown> {
  return { identityToken: 'XBL3.0 x=' + userHash + ';' + xstsToken }
}

/** User hash of an Xbox Live/XSTS response, when present. */
export function userHash(body: XboxAuthBody | undefined): string | undefined {
  const hash = body?.DisplayClaims?.xui?.[0]?.uhs?.trim()
  return hash ? hash : undefined
}

/** Inputs for {@link buildMicrosoftAccount}. */
export interface MicrosoftAccountInput {
  profile: MinecraftProfileBody | undefined
  tokens: MicrosoftTokens
  /** XUID reported by XSTS; the launch arguments pass it as '--xuid'. */
  xuid?: string
  now?: number
  /** Existing record, kept for its id and previous refresh token. */
  previous?: Account
}

/** Account record plus the fields only the Microsoft flow can provide. */
export interface MicrosoftAccount extends Account {
  /** Xbox user id, consumed by the launch command builder. */
  xuid?: string
}

/**
 * Map the Minecraft profile + tokens into the launcher's account record.
 *
 * @returns the account, or undefined when the profile has no id/name.
 */
export function buildMicrosoftAccount(input: MicrosoftAccountInput): MicrosoftAccount | undefined {
  const uuid = expandUuid(input.profile?.id)
  const name = input.profile?.name?.trim()
  if (!uuid || !name) return undefined
  const now = input.now ?? Date.now()
  const activeSkin = input.profile?.skins?.find((skin) => (skin?.state ?? '').toUpperCase() === 'ACTIVE')
    ?? input.profile?.skins?.[0]
  const variant = activeSkin?.variant?.toLowerCase()
  const account: MicrosoftAccount = {
    id: input.previous?.id ?? 'microsoft-' + uuid,
    kind: 'microsoft',
    name,
    uuid,
    // The raw skin texture is not an avatar; the UI derives a head render
    // from the UUID when the avatar field is absent.
    accessToken: input.tokens.accessToken,
    refreshToken: input.tokens.refreshToken ?? input.previous?.refreshToken,
    expiresAt: now + input.tokens.expiresIn * 1000,
    skinModel: variant === 'slim' ? 'slim' : variant === 'classic' ? 'classic' : undefined,
  }
  if (input.xuid) account.xuid = input.xuid
  return account
}

/** XUID of an XSTS response, when the claim is present. */
export function xboxUserId(body: XboxAuthBody | undefined): string | undefined {
  const xuid = body?.DisplayClaims?.xui?.[0]?.xid?.trim()
  return xuid ? xuid : undefined
}

/** True when a stored token is close enough to expiry to refresh early. */
export function needsRefresh(account: Account, now = Date.now(), marginMs = 60_000): boolean {
  if (account.kind !== 'microsoft') return false
  if (!account.expiresAt) return true
  return account.expiresAt - marginMs <= now
}