import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  XBOX_LIVE_AUTH_URL, XSTS_AUTH_URL, MINECRAFT_LOGIN_URL, MINECRAFT_PROFILE_URL,
  userHash, type MicrosoftTokens,
} from '../src/accounts/microsoft.ts'
import { exchangeMicrosoftForMinecraft } from '../src/accounts/microsoft-chain.ts'
import { minecraftLoginError } from '../src/accounts/minecraft-errors.ts'

const CONFIG = { clientId: '11111111-1111-4111-8111-111111111111', authority: 'https://login.microsoftonline.com/consumers/oauth2/v2.0' }
const TOKENS: MicrosoftTokens = { accessToken: 'secret-ms-token', refreshToken: 'secret-ms-refresh', expiresIn: 3600 }
const PROFILE_ID = '11111111222243338444555555555555'
function protocol(overrides: { xstsHash?: unknown; missingHash?: boolean; loginStatus?: number; loginBody?: unknown; profileStatus?: number } = {}) {
  const calls: Array<{ url: string; body?: string }> = []
  const network = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    calls.push({ url, body: typeof init?.body === 'string' ? init.body : undefined })
    const json = (value: unknown, status = 200) => Response.json(value, { status })
    if (url === XBOX_LIVE_AUTH_URL) return json({ Token: 'secret-xbox', DisplayClaims: { xui: [{ uhs: 'same-user' }] } })
    if (url === XSTS_AUTH_URL) return json({ Token: 'secret-xsts', DisplayClaims: { xui: [{ uhs: overrides.missingHash ? undefined : overrides.xstsHash ?? 'same-user', xid: '123' }] } })
    if (url === MINECRAFT_LOGIN_URL) return json(overrides.loginBody ?? { access_token: 'secret-minecraft', expires_in: 3600 }, overrides.loginStatus ?? 200)
    if (url === MINECRAFT_PROFILE_URL) return json({ id: PROFILE_ID, name: 'Fixture', skins: [] }, overrides.profileStatus ?? 200)
    throw new Error('Unexpected external request')
  })
  vi.stubGlobal('fetch', network)
  return { calls, network }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('Minecraft authentication error classification', () => {
  it('keeps the successful HMCL protocol and bound app identity unchanged', async () => {
    const { calls } = protocol()
    const account = await exchangeMicrosoftForMinecraft(TOKENS, CONFIG)
    expect(account).toMatchObject({ kind: 'microsoft', name: 'Fixture', microsoftClientId: CONFIG.clientId, accessToken: 'secret-minecraft' })
    expect(calls.map(call => call.url)).toEqual([XBOX_LIVE_AUTH_URL, XSTS_AUTH_URL, MINECRAFT_LOGIN_URL, MINECRAFT_PROFILE_URL])
    expect(JSON.parse(calls[2].body!)).toEqual({ identityToken: 'XBL3.0 x=same-user;secret-xsts' })
    expect(JSON.parse(calls[1].body!).RelyingParty).toBe('rp://api.minecraftservices.com/')
  })

  it.each([
    { status: 403, body: { error: 'ForbiddenOperationException', errorMessage: 'Invalid app registration, see https://aka.ms/AppRegInfo; secret-ms-token' }, code: 'MINECRAFT_APP_NOT_APPROVED' },
    { status: 403, body: { error: 'ForbiddenOperationException', errorMessage: 'Forbidden secret-ms-token' }, code: 'MINECRAFT_ACCESS_DENIED' },
    { status: 401, body: { error: 'UnauthorizedOperationException', errorMessage: 'invalid secret-xsts' }, code: 'MINECRAFT_IDENTITY_REJECTED' },
    { status: 429, body: { error: 'TooManyRequestsException', message: 'secret-minecraft' }, code: 'MINECRAFT_RATE_LIMITED' },
    { status: 200, body: { errorMessage: 'secret-ms-refresh' }, code: 'MINECRAFT_INVALID_TOKEN_RESPONSE' },
  ])('classifies HTTP $status as $code without blaming ownership or echoing credentials', async ({ status, body, code }) => {
    const { calls } = protocol({ loginStatus: status, loginBody: body })
    let failure: unknown
    try { await exchangeMicrosoftForMinecraft(TOKENS, CONFIG) } catch (error) { failure = error }
    expect(failure).toMatchObject({ code, diagnostic: { stage: 'minecraft-login', upstreamStatus: status } })
    expect(String(failure)).not.toMatch(/secret-ms-token|secret-xsts|secret-minecraft|secret-ms-refresh|账号已购买游戏/)
    expect(calls.some(call => call.url === MINECRAFT_PROFILE_URL)).toBe(false)
  })

  it('does not classify a bare 403 as proof of an app approval or ownership decision', () => {
    const error = minecraftLoginError(403, { error: 'Anything-unknown', errorMessage: 'secret-echo' })
    expect(error.code).toBe('MINECRAFT_ACCESS_DENIED')
    expect(error.diagnostic?.providerCode).toBeUndefined()
    expect(error.message).not.toContain('secret-echo')
  })

  it.each([{ missingHash: true }, { xstsHash: 'different-user' }, { xstsHash: 42 }])('rejects missing or mismatched XSTS identity before sending any Minecraft token request (%j)', async (overrides) => {
    const { calls } = protocol(overrides)
    await expect(exchangeMicrosoftForMinecraft(TOKENS, CONFIG)).rejects.toMatchObject({ code: 'XSTS_IDENTITY_MISMATCH', diagnostic: { stage: 'xsts' } })
    expect(calls).toHaveLength(2)
  })

  it('does not mistake a missing Java profile for proof that the game was never purchased', async () => {
    protocol({ profileStatus: 404 })
    await expect(exchangeMicrosoftForMinecraft(TOKENS, CONFIG)).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND', diagnostic: { stage: 'minecraft-profile', upstreamStatus: 404 }, message: expect.stringContaining('若已购买') })
  })

  it('does not throw an unclassified TypeError for malformed claims', () => {
    expect(userHash({ DisplayClaims: { xui: [{ uhs: 42 as unknown as string }] } })).toBeUndefined()
  })
})
