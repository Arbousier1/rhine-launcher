import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { Settings } from '../types.ts'
import { AccountError } from './errors.ts'
import { SECRET_ENV, envValue, resolveMicrosoftClientId } from '../config/secrets.ts'
import { builtinMicrosoftClientId } from './builtin-app.ts'

export const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
export interface MicrosoftConfiguration { clientId: string; authority: string }
export interface MicrosoftBeginInput { clientId?: string; authority?: string }

/**
 * Resolve the application identity used for a Microsoft login.
 *
 * Precedence: explicit request input → `RHINE_MICROSOFT_CLIENT_ID` env var →
 * persisted setting → the identity this release ships with. The built-in entry
 * is the project's own public-client registration (see `./builtin-app.ts`), the
 * shipping model HMCL uses; it is never another project's app.
 */
export function microsoftConfiguration(input: MicrosoftBeginInput = {}, settings?: Pick<Settings, 'microsoftClientId'> & { microsoftAuthority?: string }): MicrosoftConfiguration {
  const clientId = input.clientId ?? resolveMicrosoftClientId(settings?.microsoftClientId, builtinMicrosoftClientId(SECRET_ENV.microsoftClientId)).value
  if (!clientId) throw new AccountError('缺少 Microsoft OAuth client_id。此发行版未内置应用身份（发行方可设 RHINE_MICROSOFT_CLIENT_ID=off 关闭内置值），请在“微软登录设置”填写你拥有或获准使用的应用 ID。', 'MICROSOFT_CLIENT_ID_REQUIRED')
  if (typeof clientId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(clientId.trim())) throw new AccountError('Microsoft OAuth client_id 必须为你注册的应用 ID（GUID）', 'INVALID_CLIENT_ID')
  const authority = normalizeMicrosoftAuthority(input.authority ?? (envValue(SECRET_ENV.microsoftAuthority) || settings?.microsoftAuthority?.trim() || MICROSOFT_AUTHORITY))
  return { clientId: clientId.trim(), authority }
}
export function featureMicrosoftConfiguration(env: FeatureEnvironment, input: MicrosoftBeginInput = {}): MicrosoftConfiguration {
  const settings = env.use<Settings>('settings.get')
  return microsoftConfiguration(input, settings)
}
export function normalizeMicrosoftAuthority(value: string): string {
  if (typeof value !== 'string') throw new AccountError('Microsoft authority 无效', 'INVALID_AUTHORITY')
  const raw = value.trim()
  const tenant = /^(consumers|common|organizations|[0-9a-f-]{36})$/i.test(raw) ? 'https://login.microsoftonline.com/' + raw + '/oauth2/v2.0' : raw
  let url: URL
  try { url = new URL(tenant) } catch { throw new AccountError('Microsoft authority 必须为 Microsoft Identity Platform 的 HTTPS v2.0 地址', 'INVALID_AUTHORITY') }
  if (url.protocol !== 'https:' || url.hostname !== 'login.microsoftonline.com' || url.port || url.username || url.password || url.search || url.hash || !/^\/[A-Za-z0-9.-]+\/oauth2\/v2\.0\/?$/.test(url.pathname)) {
    throw new AccountError('仅允许 https://login.microsoftonline.com/<tenant>/oauth2/v2.0 authority，不能把令牌发送到第三方地址', 'INVALID_AUTHORITY')
  }
  return url.href.replace(/\/+$/, '')
}
export function microsoftEndpoints(config: MicrosoftConfiguration): { deviceCode: string; token: string } {
  return { deviceCode: config.authority + '/devicecode', token: config.authority + '/token' }
}
