import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { Settings } from '../types.ts'
import { AccountError } from './errors.ts'
import { SECRET_ENV, envValue, resolveMicrosoftClientId } from '../config/secrets.ts'

export const MICROSOFT_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
export interface MicrosoftConfiguration { clientId: string; authority: string }
export interface MicrosoftBeginInput { clientId?: string; authority?: string }

/**
 * Only the user's/app owner's explicit application registration is used.
 *
 * Precedence: explicit request input → `RHINE_MICROSOFT_CLIENT_ID` env var →
 * persisted setting. The environment comes before settings so a packaged build
 * can carry the owner's app identity without shipping it in `launcher.json`.
 */
export function microsoftConfiguration(input: MicrosoftBeginInput = {}, settings?: Pick<Settings, 'microsoftClientId'> & { microsoftAuthority?: string }): MicrosoftConfiguration {
  const clientId = input.clientId ?? resolveMicrosoftClientId(settings?.microsoftClientId).value
  if (!clientId) throw new AccountError('请先配置你拥有或获准使用的 Microsoft OAuth client_id：设置环境变量 RHINE_MICROSOFT_CLIENT_ID，或在设置 → 账号中填写；启动器不会借用 Prism/MultiMC 的应用。也可向 /api/accounts/microsoft/start 直接提交 clientId。', 'MICROSOFT_CLIENT_ID_REQUIRED')
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
