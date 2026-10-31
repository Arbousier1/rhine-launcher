import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Account } from '../src/types.ts'
import {
  AUTHORIZATION_PENDING, MINECRAFT_LOGIN_URL, MINECRAFT_PROFILE_URL, MICROSOFT_DEVICE_CODE_URL,
  MICROSOFT_TOKEN_URL, XBOX_LIVE_AUTH_URL, XSTS_AUTH_URL, buildMicrosoftAccount,
  minecraftLoginPayload, needsRefresh, oauthErrorHint, parseDeviceCode, parseTokenBody,
  tokenErrorCode, userHash, xboxLivePayload, xboxUserId, xstsErrorHint, xstsPayload,
} from '../src/accounts/microsoft.ts'
import { compactUuid, expandUuid, formatUuid, isUuid, offlineUuid } from '../src/accounts/uuid.ts'
import { ACCOUNT_FILE, AccountError, AccountService } from '../src/services/accounts.ts'
import { PathsService } from '../src/services/paths.ts'
import { StorageService } from '../src/services/storage.ts'

// Fixture app ID only; no third-party project's production OAuth registration is borrowed.
const TEST_CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const TEST_AUTHORITY = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const NOTCH_UUID = '069a79f4-44e9-4726-a5be-fca90e38aaf5'
const NOTCH_COMPACT = '069a79f444e94726a5befca90e38aaf5'

function createContext(root: string): Context {
  const ctx = new Context()
  ctx.provide('settings', { get: () => ({ microsoftClientId: '11111111-1111-4111-8111-111111111111' }) } as never)
  ctx.provide('paths', new PathsService(ctx, { root }))
  ctx.provide('storage', new StorageService(ctx))
  return ctx
}

/** JSON response helper for the stubbed global fetch. */
function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}

interface FetchCall {
  url: string
  body?: string
}

/**
 * Stub the whole Microsoft chain.
 *
 * @param tokenMode — 'pending' keeps the device-code poll unanswered.
 */
function stubMicrosoftFetch(tokenMode: 'pending' | 'success', calls: FetchCall[]): void {
  vi.stubGlobal('fetch', async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    const body = typeof init?.body === 'string' ? init.body : undefined
    calls.push({ url, body })
    if (url === MICROSOFT_DEVICE_CODE_URL) {
      return json({
        user_code: 'ABCD-EFGH',
        device_code: 'device-code-1',
        verification_uri: 'https://microsoft.com/devicelogin',
        expires_in: 900,
        interval: 5,
      })
    }
    if (url === MICROSOFT_TOKEN_URL) {
      if (body?.includes('grant_type=refresh_token')) {
        return json({ access_token: 'msa-refreshed', refresh_token: 'refresh-2', expires_in: 3600 })
      }
      if (tokenMode === 'pending') {
        return json({ error: AUTHORIZATION_PENDING, error_description: 'authorization pending' }, 400)
      }
      return json({ access_token: 'msa-access', refresh_token: 'refresh-1', expires_in: 3600 })
    }
    if (url === XBOX_LIVE_AUTH_URL) {
      return json({ Token: 'xbl-token', DisplayClaims: { xui: [{ uhs: 'uhs-1' }] } })
    }
    if (url === XSTS_AUTH_URL) {
      return json({ Token: 'xsts-token', DisplayClaims: { xui: [{ uhs: 'uhs-1', xid: '2535412345678901' }] } })
    }
    if (url === MINECRAFT_LOGIN_URL) {
      return json({ access_token: 'minecraft-access', expires_in: 86_400 })
    }
    if (url === MINECRAFT_PROFILE_URL) {
      return json({
        id: NOTCH_COMPACT,
        name: 'Notch',
        skins: [{ id: 'skin', state: 'ACTIVE', url: 'https://textures.example/skin', variant: 'SLIM' }],
      })
    }
    throw new Error('unexpected url: ' + url)
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.useRealTimers()
})

describe('uuid helpers', () => {
  it('derives the vanilla offline uuid', () => {
    expect(offlineUuid('Notch')).toBe('b50ad385-829d-3141-a216-7e7d7539ba7f')
    expect(offlineUuid('frank')).toBe('5a501248-8cf8-3c52-96f1-6045494ea984')
    expect(offlineUuid('小艾')).toBe('123d0bca-9d4a-3315-8a0e-989964228b0f')
    // version 3 + RFC 4122 variant
    expect(offlineUuid('Steve')[14]).toBe('3')
    expect(['8', '9', 'a', 'b']).toContain(offlineUuid('Steve')[19])
  })

  it('formats, expands and validates uuids', () => {
    expect(expandUuid(NOTCH_COMPACT)).toBe(NOTCH_UUID)
    expect(expandUuid(NOTCH_UUID)).toBe(NOTCH_UUID)
    expect(expandUuid('nope')).toBeUndefined()
    expect(compactUuid(NOTCH_UUID)).toBe(NOTCH_COMPACT)
    expect(isUuid(NOTCH_UUID)).toBe(true)
    expect(isUuid('nope')).toBe(false)
    expect(() => formatUuid(new Uint8Array(4))).toThrow(/UUID/)
  })
})

describe('microsoft protocol helpers', () => {
  it('parses a device code response', () => {
    const flow = parseDeviceCode({
      user_code: 'ABCD-EFGH',
      device_code: 'device',
      verification_uri: 'https://microsoft.com/devicelogin',
      expires_in: 900,
      interval: 5,
    }, 1_000)
    expect(flow).toEqual({
      userCode: 'ABCD-EFGH',
      verificationUri: 'https://microsoft.com/devicelogin',
      deviceCode: 'device',
      intervalMs: 5000,
      expiresAt: 1_000 + 900_000,
    })
    expect(parseDeviceCode(undefined)).toBeUndefined()
    expect(parseDeviceCode({ user_code: 'x', device_code: 'y' })).toBeUndefined()
  })

  it('reads token responses and oauth errors', () => {
    expect(parseTokenBody({ access_token: 'a', expires_in: 60 })).toEqual({
      accessToken: 'a',
      refreshToken: undefined,
      expiresIn: 60,
      userId: undefined,
    })
    expect(parseTokenBody({})).toBeUndefined()
    expect(tokenErrorCode({ error: AUTHORIZATION_PENDING })).toBe(AUTHORIZATION_PENDING)
    expect(tokenErrorCode({})).toBeUndefined()
    expect(oauthErrorHint(AUTHORIZATION_PENDING)).toContain('授权尚未完成')
    expect(oauthErrorHint('authorization_declined')).toContain('拒绝')
    expect(oauthErrorHint('expired_token')).toContain('过期')
    expect(xstsErrorHint(2148916233)).toContain('Xbox Live')
    expect(xstsErrorHint(2148916238)).toContain('家庭组')
    expect(xstsErrorHint(12345)).toContain('Minecraft')
  })

  it('builds the xbox -> minecraft payloads', () => {
    expect(xboxLivePayload('msa').Properties).toMatchObject({ RpsTicket: 'd=msa' })
    expect(xstsPayload('xbl').Properties).toMatchObject({ UserTokens: ['xbl'] })
    expect(minecraftLoginPayload('uhs', 'xsts')).toEqual({ identityToken: 'XBL3.0 x=uhs;xsts' })
    expect(userHash({ DisplayClaims: { xui: [{ uhs: 'u' }] } })).toBe('u')
    expect(userHash({})).toBeUndefined()
    expect(xboxUserId({ DisplayClaims: { xui: [{ xid: '2535412345678901' }] } })).toBe('2535412345678901')
    expect(xboxUserId({})).toBeUndefined()
  })

  it('maps a profile into an account record', () => {
    const account = buildMicrosoftAccount({
      profile: {
        id: NOTCH_COMPACT,
        name: 'Notch',
        skins: [{ state: 'ACTIVE', url: 'https://textures.example/skin', variant: 'SLIM' }],
      },
      tokens: { accessToken: 'mc', refreshToken: 'refresh', expiresIn: 3600 },
      now: 1_000,
    })
    expect(account).toMatchObject({
      id: 'microsoft-' + NOTCH_UUID,
      kind: 'microsoft',
      name: 'Notch',
      uuid: NOTCH_UUID,
      accessToken: 'mc',
      refreshToken: 'refresh',
      expiresAt: 1_000 + 3_600_000,
      skinModel: 'slim',
    })
    expect(buildMicrosoftAccount({ profile: { name: 'x' }, tokens: { accessToken: 'a', expiresIn: 1 } })).toBeUndefined()

    const previous: Account = {
      id: 'microsoft-' + NOTCH_UUID,
      kind: 'microsoft',
      name: 'Notch',
      uuid: NOTCH_UUID,
      refreshToken: 'old-refresh',
    }
    const refreshed = buildMicrosoftAccount({
      profile: { id: NOTCH_COMPACT, name: 'Notch' },
      tokens: { accessToken: 'mc2', expiresIn: 60 },
      previous,
    })
    expect(refreshed?.id).toBe(previous.id)
    expect(refreshed?.refreshToken).toBe('old-refresh')
    expect(needsRefresh(previous)).toBe(true)
    expect(needsRefresh({ ...previous, expiresAt: Date.now() + 3_600_000 })).toBe(false)
    expect(needsRefresh({ id: 'o', kind: 'offline', name: 'x', uuid: NOTCH_UUID })).toBe(false)
  })
})

describe('offline accounts', () => {
  const roots: string[] = []

  afterEach(async () => {
    while (roots.length > 0) {
      await rm(roots.pop()!, { recursive: true, force: true })
    }
  })

  async function setup(): Promise<{ root: string; service: AccountService }> {
    const root = await mkdtemp(join(tmpdir(), 'rhine-accounts-'))
    roots.push(root)
    const ctx = createContext(root)
    return { root, service: new AccountService(ctx) }
  }

  it('creates, lists and persists an offline account', async () => {
    const { root, service } = await setup()
    const account = await service.addOffline('Notch')
    expect(account).toMatchObject({ kind: 'offline', name: 'Notch', uuid: 'b50ad385-829d-3141-a216-7e7d7539ba7f' })
    expect(account.id.startsWith('offline-')).toBe(true)
    expect(service.list()).toHaveLength(1)
    expect(service.get(account.id)?.name).toBe('Notch')

    const stored = JSON.parse(await readFile(join(root, ACCOUNT_FILE), 'utf8')) as Account[]
    expect(stored).toHaveLength(1)
    expect(stored[0].uuid).toBe(account.uuid)

    // Creating the same identity again reuses the record.
    expect((await service.addOffline('Notch')).id).toBe(account.id)
    expect(service.list()).toHaveLength(1)
  })

  it('rejects invalid names', async () => {
    const { service } = await setup()
    await expect(service.addOffline('')).rejects.toThrow(/请输入玩家名/)
    await expect(service.addOffline('bad name!')).rejects.toThrow(/只能包含字母/)
    await expect(service.addOffline('x'.repeat(17))).rejects.toThrow(/只能包含字母/)
  })

  it('removes accounts and reloads the file', async () => {
    const { root, service } = await setup()
    const account = await service.addOffline('Alex')
    await service.remove(account.id)
    expect(service.list()).toEqual([])
    await expect(service.remove('missing')).rejects.toBeInstanceOf(AccountError)

    await service.addOffline('Steve')
    const ctx = createContext(root)
    const reloaded = new AccountService(ctx)
    expect(reloaded.list().map((item) => item.name)).toEqual(['Steve'])
  })

  it('authorizes offline accounts without touching the network', async () => {
    const { service } = await setup()
    const account = await service.addOffline('Alex')
    const authorized = await service.authorize(account.id)
    expect(authorized).toEqual(account)
    expect(await service.refresh(account.id)).toEqual(account)
    await expect(service.authorize('missing')).rejects.toThrow(/账号不存在/)
  })
})

describe('microsoft accounts', () => {
  const roots: string[] = []

  afterEach(async () => {
    while (roots.length > 0) {
      await rm(roots.pop()!, { recursive: true, force: true })
    }
  })

  async function setup(): Promise<{ root: string; service: AccountService; calls: FetchCall[] }> {
    const root = await mkdtemp(join(tmpdir(), 'rhine-accounts-'))
    roots.push(root)
    const ctx = createContext(root)
    return { root, service: new AccountService(ctx, { clientId: TEST_CLIENT_ID }), calls: [] }
  }

  it('starts the device-code flow', async () => {
    const { service, calls } = await setup()
    stubMicrosoftFetch('pending', calls)
    const flow = await service.beginMicrosoft()
    expect(flow.userCode).toBe('ABCD-EFGH')
    expect(flow.verificationUri).toBe('https://microsoft.com/devicelogin')
    expect(flow.intervalMs).toBe(5000)
    expect(flow.expiresAt).toBeGreaterThan(Date.now())
    expect(calls[0].url).toBe(MICROSOFT_DEVICE_CODE_URL)
    expect(calls[0].body).toContain('client_id=' + TEST_CLIENT_ID)
    expect(calls[0].body).toContain('scope=XboxLive.signin')
    const method = calls[0] as FetchCall & { init?: RequestInit }
    expect(method.url).toBeTruthy()
  })

  it('signals authorization_pending while the user is signing in', async () => {
    const { service, calls } = await setup()
    stubMicrosoftFetch('pending', calls)
    await service.beginMicrosoft()
    let failure: unknown
    try {
      await service.completeMicrosoft()
    } catch (error) {
      failure = error
    }
    expect(failure).toBeInstanceOf(AccountError)
    expect((failure as AccountError).code).toBe(AUTHORIZATION_PENDING)
    expect((failure as Error).message).toMatch(/authorization_pending/)
    // The flow stays pending, so the UI can poll again.
    await expect(service.completeMicrosoft()).rejects.toMatchObject({ code: AUTHORIZATION_PENDING })
  })

  it('reports a pending flow error before beginMicrosoft', async () => {
    const { service } = await setup()
    await expect(service.completeMicrosoft()).rejects.toMatchObject({ code: 'NO_PENDING_FLOW' })
  })

  it('expires the device code', async () => {
    const { service, calls } = await setup()
    stubMicrosoftFetch('pending', calls)
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-01-01T00:00:00Z'))
    await service.beginMicrosoft()
    vi.setSystemTime(new Date('2026-01-01T00:16:00Z'))
    await expect(service.completeMicrosoft()).rejects.toMatchObject({ code: 'EXPIRED_TOKEN' })
    expect(calls).toHaveLength(1)
  })

  it('completes the full xbox -> minecraft chain', async () => {
    const { root, service, calls } = await setup()
    stubMicrosoftFetch('success', calls)
    await service.beginMicrosoft()
    const account = await service.completeMicrosoft()

    expect(account).toMatchObject({
      id: 'microsoft-' + NOTCH_UUID,
      kind: 'microsoft',
      name: 'Notch',
      uuid: NOTCH_UUID,
      accessToken: 'minecraft-access',
      refreshToken: 'refresh-1',
      skinModel: 'slim',
      xuid: '2535412345678901',
    })
    expect(account.expiresAt).toBeGreaterThan(Date.now())
    expect(service.list()).toHaveLength(1)

    // The XSTS user hash is carried into the Minecraft login payload.
    const login = calls.find((call) => call.url === MINECRAFT_LOGIN_URL)
    expect(login?.body).toContain('XBL3.0 x=uhs-1;xsts-token')

    const stored = JSON.parse(await readFile(join(root, ACCOUNT_FILE), 'utf8')) as Account[]
    expect(stored[0].accessToken).toBe('minecraft-access')

    // completeMicrosoft clears the pending flow.
    await expect(service.completeMicrosoft()).rejects.toMatchObject({ code: 'NO_PENDING_FLOW' })
  })

  it('refreshes an expired microsoft account before launching', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-accounts-'))
    roots.push(root)
    const ctx = createContext(root)
    const stale: Account = {
      id: 'microsoft-' + NOTCH_UUID,
      kind: 'microsoft',
      name: 'Notch',
      uuid: NOTCH_UUID,
      accessToken: 'stale',
      refreshToken: 'refresh-1',
      microsoftClientId: TEST_CLIENT_ID,
      microsoftAuthority: TEST_AUTHORITY,
      expiresAt: Date.now() - 1_000,
    }
    await ctx.storage.write(join(root, ACCOUNT_FILE), [stale])
    const service = new AccountService(ctx)
    const calls: FetchCall[] = []
    stubMicrosoftFetch('success', calls)

    const authorized = await service.authorize(stale.id)
    expect(authorized.accessToken).toBe('minecraft-access')
    expect(authorized.refreshToken).toBe('refresh-2')
    expect(authorized.expiresAt).toBeGreaterThan(Date.now())
    expect(calls.some((call) => call.url === MICROSOFT_TOKEN_URL)).toBe(true)
    expect(calls.find((call) => call.url === MICROSOFT_TOKEN_URL)?.body).toContain('grant_type=refresh_token')

    // A fresh token is reused without another network round trip.
    const before = calls.length
    const reused = await service.authorize(stale.id)
    expect(reused.accessToken).toBe('minecraft-access')
    expect(calls.length).toBe(before)
  })
})
