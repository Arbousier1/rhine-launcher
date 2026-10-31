import type { Account } from '../types.ts'
import { AccountError } from './errors.ts'
import { JSON_HEADERS, requestJson } from './http.ts'
import {
  XBOX_LIVE_AUTH_URL, XSTS_AUTH_URL, MINECRAFT_LOGIN_URL, MINECRAFT_PROFILE_URL,
  xboxLivePayload, xstsPayload, minecraftLoginPayload, userHash, xboxUserId,
  xstsErrorHint, buildMicrosoftAccount, type XboxAuthBody, type MinecraftLoginBody,
  type MinecraftProfileBody, type MicrosoftTokens,
} from './microsoft.ts'
import type { MicrosoftConfiguration } from './config.ts'

/** Protocol exchange used by the complete and refresh actions; no public service registration. */
export async function exchangeMicrosoftForMinecraft(tokens: MicrosoftTokens, config: MicrosoftConfiguration, signal?: AbortSignal, previous?: Account): Promise<Account> {
  const xbox = await requestJson<XboxAuthBody>(XBOX_LIVE_AUTH_URL, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(xboxLivePayload(tokens.accessToken)),
  }, 'Xbox Live 身份验证', signal)
  const xboxToken = xbox.body?.Token
  const xboxHash = userHash(xbox.body)
  if (xbox.status < 200 || xbox.status >= 300 || typeof xboxToken !== 'string' || !xboxToken || !xboxHash) {
    throw new AccountError('Xbox Live 身份验证失败，请稍后重试', 'XBL_FAILED')
  }
  const xsts = await requestJson<XboxAuthBody>(XSTS_AUTH_URL, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(xstsPayload(xboxToken)),
  }, 'Xbox Live 授权', signal)
  const xstsToken = xsts.body?.Token
  if (xsts.status < 200 || xsts.status >= 300 || typeof xstsToken !== 'string' || !xstsToken) {
    throw new AccountError(xstsErrorHint(xsts.body?.XErr), 'XSTS_FAILED')
  }
  const minecraft = await requestJson<MinecraftLoginBody>(MINECRAFT_LOGIN_URL, {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify(minecraftLoginPayload(userHash(xsts.body) ?? xboxHash, xstsToken)),
  }, 'Minecraft 登录', signal)
  const accessToken = typeof minecraft.body?.access_token === 'string' ? minecraft.body.access_token.trim() : ''
  if (minecraft.status < 200 || minecraft.status >= 300 || !accessToken) {
    throw new AccountError('Minecraft 登录失败，请确认该应用允许 Minecraft 登录且账号已购买游戏', 'MINECRAFT_LOGIN_FAILED')
  }
  const profile = await requestJson<MinecraftProfileBody>(MINECRAFT_PROFILE_URL, {
    method: 'GET', headers: { authorization: 'Bearer ' + accessToken, accept: 'application/json' },
  }, '获取 Minecraft 档案', signal)
  if (profile.status === 404) throw new AccountError('该微软账号没有 Minecraft 游戏档案（可能尚未购买游戏）', 'PROFILE_NOT_FOUND')
  if (profile.status < 200 || profile.status >= 300) throw new AccountError('读取 Minecraft 档案失败，请稍后重试', 'PROFILE_FAILED')
  const expiresIn = Number(minecraft.body?.expires_in)
  const account = buildMicrosoftAccount({
    profile: profile.body, xuid: xboxUserId(xsts.body), previous,
    tokens: { ...tokens, accessToken, expiresIn: Number.isFinite(expiresIn) && expiresIn > 0 ? expiresIn : tokens.expiresIn },
  })
  if (!account) throw new AccountError('无法读取 Minecraft 档案（缺少有效 UUID 或名称）', 'PROFILE_INVALID')
  if (previous && account.uuid !== previous.uuid) throw new AccountError('刷新得到的 Minecraft 档案与原账号不一致，请重新登录', 'PROFILE_MISMATCH')
  return { ...account, avatar: account.avatar ?? previous?.avatar, skinModel: account.skinModel ?? previous?.skinModel,
    microsoftClientId: config.clientId, microsoftAuthority: config.authority }
}
