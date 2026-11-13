import type { Account } from '../types.ts'
import { AccountError, type AuthenticationStage } from './errors.ts'
import { JSON_HEADERS, requestJson } from './http.ts'
import {
  XBOX_LIVE_AUTH_URL, XSTS_AUTH_URL, MINECRAFT_LOGIN_URL, MINECRAFT_PROFILE_URL,
  xboxLivePayload, xstsPayload, minecraftLoginPayload, userHash, xboxUserId,
  xstsErrorHint, buildMicrosoftAccount, type XboxAuthBody, type MinecraftLoginBody,
  type MinecraftProfileBody, type MicrosoftTokens,
} from './microsoft.ts'
import type { MicrosoftConfiguration } from './config.ts'
import { minecraftLoginError } from './minecraft-errors.ts'

/** Preserve a safe failure stage even when transport or JSON parsing fails. */
async function authenticationRequest<T>(stage: AuthenticationStage, url: string, init: RequestInit, label: string, signal?: AbortSignal) {
  try { return await requestJson<T>(url, init, label, signal) }
  catch (error) {
    if (!(error instanceof AccountError)) throw error
    throw new AccountError(error.message, error.code, { status: error.status, diagnostic: { stage } })
  }
}

/** Protocol exchange used by complete/refresh; ownership is not tested by login_with_xbox. */
export async function exchangeMicrosoftForMinecraft(tokens: MicrosoftTokens, config: MicrosoftConfiguration, signal?: AbortSignal, previous?: Account): Promise<Account> {
  const xbox = await authenticationRequest<XboxAuthBody>('xbox-live', XBOX_LIVE_AUTH_URL, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(xboxLivePayload(tokens.accessToken)),
  }, 'Xbox Live 身份验证', signal)
  const xboxToken = xbox.body?.Token
  const xboxHash = userHash(xbox.body)
  if (xbox.status < 200 || xbox.status >= 300 || typeof xboxToken !== 'string' || !xboxToken.trim() || !xboxHash || xbox.body?.XErr) {
    throw new AccountError('Xbox Live 身份验证失败，请重新授权或稍后重试（HTTP ' + xbox.status + '）', 'XBL_FAILED', {
      status: 502, diagnostic: { stage: 'xbox-live', upstreamStatus: xbox.status },
    })
  }
  const xsts = await authenticationRequest<XboxAuthBody>('xsts', XSTS_AUTH_URL, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(xstsPayload(xboxToken)),
  }, 'Xbox Live 授权', signal)
  const xstsToken = xsts.body?.Token
  if (xsts.status < 200 || xsts.status >= 300 || typeof xstsToken !== 'string' || !xstsToken.trim() || xsts.body?.XErr) {
    throw new AccountError(xstsErrorHint(xsts.body?.XErr) + '（HTTP ' + xsts.status + '）', 'XSTS_FAILED', {
      status: 502, diagnostic: { stage: 'xsts', upstreamStatus: xsts.status },
    })
  }
  // HMCL requires XSTS uhs to exist and equal the preceding XBL identity.
  // Never guess a missing hash or exchange a token belonging to another user.
  const xstsHash = userHash(xsts.body)
  if (!xstsHash || xstsHash !== xboxHash) {
    throw new AccountError('Xbox 与 XSTS 返回的身份信息缺失或不一致，请重新登录微软账号。未向 Minecraft 提交此授权。', 'XSTS_IDENTITY_MISMATCH', {
      status: 502, diagnostic: { stage: 'xsts', upstreamStatus: xsts.status },
    })
  }
  const minecraft = await authenticationRequest<MinecraftLoginBody>('minecraft-login', MINECRAFT_LOGIN_URL, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(minecraftLoginPayload(xstsHash, xstsToken)),
  }, 'Minecraft 登录', signal)
  const accessToken = typeof minecraft.body?.access_token === 'string' ? minecraft.body.access_token.trim() : ''
  if (minecraft.status < 200 || minecraft.status >= 300 || !accessToken) {
    throw minecraftLoginError(minecraft.status, minecraft.body)
  }
  const profile = await authenticationRequest<MinecraftProfileBody>('minecraft-profile', MINECRAFT_PROFILE_URL, {
    method: 'GET', headers: { authorization: 'Bearer ' + accessToken, accept: 'application/json' },
  }, '获取 Minecraft 档案', signal)
  if (profile.status === 404) throw new AccountError('该微软账号的 Minecraft Java 游戏档案尚未可用。若已购买，请确认是同一微软账号，并到 Minecraft 官网建立 Java 游戏角色；不会仅凭此响应认定你未购买。', 'PROFILE_NOT_FOUND', {
    status: 404, diagnostic: { stage: 'minecraft-profile', upstreamStatus: 404 },
  })
  if (profile.status < 200 || profile.status >= 300) throw new AccountError('读取 Minecraft 档案失败（HTTP ' + profile.status + '），请稍后重试', 'PROFILE_FAILED', {
    status: 502, diagnostic: { stage: 'minecraft-profile', upstreamStatus: profile.status },
  })
  const expiresIn = Number(minecraft.body?.expires_in)
  const account = buildMicrosoftAccount({
    profile: profile.body, xuid: xboxUserId(xsts.body), previous,
    tokens: { ...tokens, accessToken, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : tokens.expiresIn },
  })
  if (!account) throw new AccountError('无法读取 Minecraft 档案（缺少有效 UUID 或名称）', 'PROFILE_INVALID', { diagnostic: { stage: 'minecraft-profile', upstreamStatus: profile.status } })
  if (previous && account.uuid !== previous.uuid) throw new AccountError('刷新得到的 Minecraft 档案与原账号不一致，请重新登录', 'PROFILE_MISMATCH', { diagnostic: { stage: 'minecraft-profile' } })
  return { ...account, avatar: account.avatar ?? previous?.avatar, skinModel: account.skinModel ?? previous?.skinModel,
    microsoftClientId: config.clientId, microsoftAuthority: config.authority }
}
