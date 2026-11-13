import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer, type ServerResponse } from 'node:http'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../src/index.ts'
import type { Account } from '../src/types.ts'
import { createAccountsState } from '../src/accounts/repository.ts'
import { toOriginalUser } from '@rhine/ellan-ui/projections'
import { MICROSOFT_DEVICE_CODE_URL, MICROSOFT_TOKEN_URL, XBOX_LIVE_AUTH_URL, XSTS_AUTH_URL, MINECRAFT_LOGIN_URL, MINECRAFT_PROFILE_URL } from '../src/accounts/microsoft.ts'
import { AUTHORITY_FILE, type OriginalAuthorityMetadata } from '../src/ellan/accounts.ts'
import login from '../src/plugins/features/ellan/user-login.plugin.ts'
import abort from '../src/plugins/features/ellan/user-abort-login.plugin.ts'
import remove from '../src/plugins/features/ellan/user-remove.plugin.ts'
import select from '../src/plugins/features/ellan/user-select-profile.plugin.ts'
import removeProfile from '../src/plugins/features/ellan/user-remove-profile.plugin.ts'
import authorities from '../src/plugins/features/ellan/user-authorities.plugin.ts'
import addAuthority from '../src/plugins/features/ellan/authority-add.plugin.ts'
import removeAuthority from '../src/plugins/features/ellan/authority-remove.plugin.ts'

const CLIENT_ID = '11111111-1111-4111-8111-111111111111'
const PROFILE_ID = '11111111222243338444555555555555'
const OTHER_PROFILE_ID = 'aaaaaaaa222243338444555555555555'
const descriptors = [login, abort, remove, select, removeProfile, authorities, addAuthority, removeAuthority]
type User = ReturnType<typeof toOriginalUser>
type Core = Awaited<ReturnType<typeof createHost>>
interface EllanEvent { type: string; channel?: string; args?: unknown[] }
interface LocalCall { path: string; body: Record<string, unknown>; closed: Promise<void> }

/** All credentials are fixtures. Every network request is forced to this server. */
async function localAuth() {
  const nativeFetch = globalThis.fetch
  const calls: LocalCall[] = []
  const waiting: { predicate: (call: LocalCall) => boolean; resolve: (call: LocalCall) => void; timer: ReturnType<typeof setTimeout> }[] = []
  const state = { microsoftMode: 'success' as 'success' | 'pending' | 'no-profile', holdDeviceCode: false, holdToken: false, serial: 0 }
  let base = ''
  const json = (response: ServerResponse, value: unknown, status = 200) => {
    response.writeHead(status, { 'content-type': 'application/json' })
    response.end(JSON.stringify(value))
  }
  const server = createServer(async (request, response) => {
    try {
      let raw = ''
      for await (const chunk of request) raw += chunk.toString()
      const path = new URL(request.url!, 'http://127.0.0.1').pathname
      const form = request.headers['content-type']?.includes('application/x-www-form-urlencoded')
      const body = raw ? form ? Object.fromEntries(new URLSearchParams(raw)) : JSON.parse(raw) : {}
      let close!: () => void
      const closed = new Promise<void>(resolve => { close = resolve })
      response.once('close', close)
      const call = { path, body, closed }
      calls.push(call)
      for (const entry of [...waiting]) if (entry.predicate(call)) {
        clearTimeout(entry.timer); waiting.splice(waiting.indexOf(entry), 1); entry.resolve(call)
      }
      if (path === '/ygg') return json(response, {
        meta: { serverName: 'Local fixture authority', implementationName: 'Fixture', implementationVersion: '1', links: { homepage: base + '/home', register: base + '/register' }, 'feature.non_email_login': true, 'feature.openid_configuration_url': 'https://unsupported.invalid/openid' },
        skinDomains: ['textures.fixture.invalid'], signaturePublickey: 'fixture-public-key',
      })
      if (path === '/ygg/authserver/authenticate') {
        if (String(body.username).startsWith('hold-')) return
        if (body.username === 'deny') return json(response, { error: 'ForbiddenOperationException', errorMessage: 'Hostile echo: ' + body.password }, 403)
        if (body.username === 'many') return json(response, { accessToken: 'fixture-ygg-access', clientToken: body.clientToken, availableProfiles: [{ id: PROFILE_ID, name: 'YggFixture' }, { id: OTHER_PROFILE_ID, name: 'OtherFixture' }] })
        return json(response, { accessToken: 'fixture-ygg-access', clientToken: body.clientToken, selectedProfile: { id: PROFILE_ID, name: 'YggFixture' } })
      }
      if (path === '/ygg/authserver/refresh') return json(response, { accessToken: 'fixture-ygg-bound', clientToken: body.clientToken, selectedProfile: body.selectedProfile })
      if (path === '/microsoft/devicecode') {
        if (state.holdDeviceCode) return
        const serial = ++state.serial
        return json(response, { user_code: 'USER-' + serial, device_code: 'secret-device-' + serial, verification_uri: base + '/verify', expires_in: 60, interval: 1, message: 'Local fixture authorization only' })
      }
      if (path === '/microsoft/token') {
        if (state.holdToken) return
        if (state.microsoftMode === 'pending') return json(response, { error: 'authorization_pending' }, 400)
        return json(response, { access_token: 'fixture-ms-access', refresh_token: 'fixture-ms-refresh', expires_in: 3600 })
      }
      if (path === '/microsoft/xbox') return json(response, { Token: 'fixture-xbox-token', DisplayClaims: { xui: [{ uhs: 'fixture-hash' }] } })
      if (path === '/microsoft/xsts') return json(response, { Token: 'fixture-xsts-token', DisplayClaims: { xui: [{ uhs: 'fixture-hash', xid: 'fixture-xuid' }] } })
      if (path === '/microsoft/login') return json(response, { access_token: 'fixture-minecraft-access', expires_in: 3600 })
      if (path === '/microsoft/profile') return state.microsoftMode === 'no-profile' ? json(response, {}, 404) : json(response, { id: PROFILE_ID, name: 'MicrosoftFixture', skins: [] })
      json(response, { error: 'Unknown fixture route' }, 404)
    } catch { if (!response.destroyed) json(response, { error: 'Invalid local fixture request' }, 500) }
  })
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  if (!address || typeof address === 'string') throw new Error('Local test server has no TCP address')
  base = 'http://127.0.0.1:' + address.port
  const routes = new Map<string, string>([
    [MICROSOFT_DEVICE_CODE_URL, '/microsoft/devicecode'], [MICROSOFT_TOKEN_URL, '/microsoft/token'],
    [XBOX_LIVE_AUTH_URL, '/microsoft/xbox'], [XSTS_AUTH_URL, '/microsoft/xsts'],
    [MINECRAFT_LOGIN_URL, '/microsoft/login'], [MINECRAFT_PROFILE_URL, '/microsoft/profile'],
  ])
  vi.stubGlobal('fetch', (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const route = routes.get(url)
    if (route) return nativeFetch(base + route, init)
    if (new URL(url).origin === base) return nativeFetch(input, init)
    throw new Error('External requests are forbidden in account regression tests')
  })
  return {
    base, ygg: base + '/ygg', calls, state,
    waitFor(predicate: (call: LocalCall) => boolean): Promise<LocalCall> {
      const found = calls.find(predicate)
      if (found) return Promise.resolve(found)
      return new Promise((resolve, reject) => {
        const entry = { predicate, resolve, timer: setTimeout(() => { waiting.splice(waiting.indexOf(entry), 1); reject(new Error('Expected local auth request was not observed')) }, 3000) }
        waiting.push(entry)
      })
    },
    async close() {
      for (const entry of waiting) clearTimeout(entry.timer)
      waiting.length = 0
      server.closeAllConnections()
      await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()))
    },
  }
}
async function isolatedCore(root: string): Promise<Core> {
  const core = await createHost(new Context(), { root })
  for (const id of ['ellan.user.state', 'events.subscribe', 'settings.update', 'account.list', ...descriptors.map(value => value.id)]) await core.features.enable(id)
  return core
}
function invoke<T>(core: Core, feature: string, renderer: string, ...args: unknown[]): Promise<T> {
  return Promise.resolve(core.features.call<{ result: T }>(feature, { rendererId: renderer, args })).then(value => value.result)
}
function serviceEvents(events: EllanEvent[], event: string): { service: string; event: string; args: unknown[] }[] {
  return events.filter(value => value.channel === 'service-event').map(value => value.args![0] as { service: string; event: string; args: unknown[] }).filter(value => value.event === event)
}

let root: string
let core: Core
let fixture: Awaited<ReturnType<typeof localAuth>>
let events: EllanEvent[]
let unsubscribe: () => void
beforeEach(async () => {
  // These cases drive every request to the loopback fixture and assert that no
  // real provider identity is used, so the shipped app id is switched off here.
  vi.stubEnv('RHINE_MICROSOFT_CLIENT_ID', 'off')
  vi.stubEnv('RHINE_MICROSOFT_AUTHORITY', '')
  fixture = await localAuth()
  root = await mkdtemp(join(tmpdir(), 'rhine-ellan-accounts-'))
  core = await isolatedCore(root)
  events = []
  unsubscribe = core.features.call<() => void>('events.subscribe', (event: EllanEvent) => events.push(event))
})
afterEach(async () => {
  unsubscribe?.()
  await core?.features.dispose()
  await fixture?.close()
  if (root) await rm(root, { recursive: true, force: true })
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
})

describe('atomic original UserService account features', () => {
  it('declares one operation/route per descriptor and enables only its core dependency closure', () => {
    expect(new Set(descriptors.map(value => value.id)).size).toBe(8)
    expect(new Set(descriptors.map(value => value.http!.path)).size).toBe(8)
    for (const value of descriptors) {
      expect(value.capability).toBe(value.id)
      expect(value.http!.method).toBe('POST')
      expect(value.http!.path).toMatch(/^\/api\/ellan\/services\/UserService\//)
      expect(core.features.get(value.id)?.status).toBe('enabled')
    }
    expect(core.features.has('launch.start')).toBe(false)
  })

  it('logs in a real offline core identity, commits original UserState, and never returns credentials', async () => {
    const state = await invoke<{ id: string; users: Record<string, User> }>(core, 'ellan.user.state', 'offline-ui')
    const user = await invoke<User>(core, login.id, 'offline-ui', { username: 'LocalFixture', authority: 'x://dev', password: 'not-a-credential', properties: { uuid: '', mode: '' } })
    const accounts = core.features.call<Account[]>('account.list')
    expect(accounts).toHaveLength(1)
    expect(user).toEqual(toOriginalUser(accounts[0]!))
    expect(user.authority).toBe('x://dev')
    expect(user.profiles[user.selectedProfile]!.name).toBe('LocalFixture')
    expect(JSON.stringify(user)).not.toMatch(/accessToken|refreshToken|clientToken|password/)
    expect(events.filter(value => value.channel === 'state-validating').map(value => value.args![0])).toEqual([{ id: state.id, semaphore: 1 }, { id: state.id, semaphore: 0 }])
    expect(events.find(value => value.channel === 'commit')?.args).toEqual([state.id, 'userProfile', user])
    expect(serviceEvents(events, 'user-login')[0]).toEqual({ service: 'UserService', event: 'user-login', args: ['x://dev'] })
    expect(serviceEvents(events, 'user-login-success')[0]?.args).toEqual([user])
    const again = await invoke<User>(core, login.id, 'offline-ui', { username: 'LocalFixture', authority: 'x://dev' })
    expect(again).toEqual(user)
    expect(core.features.call<Account[]>('account.list')).toHaveLength(1)
    expect(fixture.calls).toEqual([])
  })

  it('selects only the actual profile, ignores forged renderer data, and persists offline profile removal', async () => {
    const state = await invoke<{ id: string }>(core, 'ellan.user.state', 'profile-ui')
    const user = await invoke<User>(core, login.id, 'profile-ui', { username: 'ProfileFixture', authority: 'x://dev' })
    const forged = { ...user, username: 'Forged', profiles: { [OTHER_PROFILE_ID]: { id: OTHER_PROFILE_ID, name: 'Forged' } } }
    await expect(invoke(core, select.id, 'profile-ui', forged, OTHER_PROFILE_ID)).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
    await invoke(core, select.id, 'profile-ui', forged, user.selectedProfile)
    expect(events.filter(value => value.channel === 'commit').at(-1)?.args).toEqual([state.id, 'userProfile', user])
    await invoke(core, removeProfile.id, 'profile-ui', forged, user.selectedProfile)
    expect(core.features.call<Account[]>('account.list')).toEqual([])
    expect(JSON.parse(await readFile(join(root, 'accounts.json'), 'utf8'))).toEqual([])
    expect(events.filter(value => value.channel === 'commit').at(-1)?.args).toEqual([state.id, 'userProfileRemove', user.id])
    await expect(invoke(core, select.id, 'profile-ui', user, user.selectedProfile)).rejects.toMatchObject({ code: 'ACCOUNT_NOT_FOUND' })
  })

  it('does not claim custom offline UUIDs, Mojang login, or unsupported Microsoft flows', async () => {
    await expect(invoke(core, login.id, 'unsupported', { username: 'Fixture', authority: 'x://dev', properties: { uuid: OTHER_PROFILE_ID } })).rejects.toMatchObject({ code: 'CUSTOM_OFFLINE_UUID_NOT_SUPPORTED' })
    await expect(invoke(core, login.id, 'unsupported', { username: 'Fixture', authority: 'x://mojang' })).rejects.toMatchObject({ code: 'LOGIN_SERVICE_NOT_SUPPORTED', exception: { type: 'loginServiceNotSupported', authority: 'x://mojang' } })
    await expect(invoke(core, login.id, 'unsupported', { username: '', authority: 'x://microsoft', properties: { mode: 'grant-code' } })).rejects.toMatchObject({ code: 'LOGIN_FLOW_NOT_SUPPORTED' })
    await expect(invoke(core, login.id, 'unsupported', { username: 'Fixture', password: 'fixture-password', authority: fixture.ygg, properties: { mode: 'device' } })).rejects.toMatchObject({ code: 'LOGIN_FLOW_NOT_SUPPORTED' })
    expect(core.features.call<Account[]>('account.list')).toEqual([])
    expect(fixture.calls).toEqual([])
    expect(serviceEvents(events, 'user-login-success')).toEqual([])
  })

  it('reports missing Microsoft clientId clearly without any network or fabricated account', async () => {
    await invoke(core, 'ellan.user.state', 'missing-client')
    const metadata = await invoke<OriginalAuthorityMetadata[]>(core, authorities.id, 'missing-client')
    expect(metadata).toEqual([
      { authority: 'x://dev', kind: 'builtin', flow: ['anonymous'] },
      { authority: 'x://microsoft', kind: 'builtin', flow: ['device-code'], emailOnly: true, configured: false },
    ])
    await expect(invoke(core, login.id, 'missing-client', { username: '', authority: 'x://microsoft', properties: { mode: 'device' } })).rejects.toMatchObject({ code: 'MICROSOFT_CLIENT_ID_REQUIRED', message: expect.stringContaining('微软登录设置') })
    expect(fixture.calls).toEqual([])
    expect(core.features.call<Account[]>('account.list')).toEqual([])
    expect(serviceEvents(events, 'microsoft-authorize-url')).toEqual([])
    expect(serviceEvents(events, 'error')[0]?.args[0]).toMatchObject({ name: 'UserException', code: 'MICROSOFT_CLIENT_ID_REQUIRED', exception: { type: 'loginGeneral' } })
    expect(events.filter(value => value.channel === 'state-validating').at(-1)?.args?.[0]).toMatchObject({ semaphore: 0 })
  })

  it('advertises Microsoft as configured when only the shipped app identity is available', async () => {
    // Same core, but this build exposes its own registration again: the
    // original form must offer Microsoft sign-in with no user setup at all.
    vi.stubEnv('RHINE_MICROSOFT_CLIENT_ID', '')
    const metadata = await invoke<OriginalAuthorityMetadata[]>(core, authorities.id, 'builtin-app')
    expect(metadata).toEqual([
      { authority: 'x://dev', kind: 'builtin', flow: ['anonymous'] },
      { authority: 'x://microsoft', kind: 'builtin', flow: ['device-code'], emailOnly: true, configured: true },
    ])
    // Listing authorities must stay offline: no probe, no fabricated account.
    expect(fixture.calls).toEqual([])
    expect(core.features.call<Account[]>('account.list')).toEqual([])
  })

  it('uses the local Microsoft chain, emits exact original authorize/device events, and commits only real token-free users', async () => {
    await core.features.call('settings.update', { microsoftClientId: CLIENT_ID })
    const state = await invoke<{ id: string }>(core, 'ellan.user.state', 'ms-ui')
    const user = await invoke<User>(core, login.id, 'ms-ui', { username: '', authority: 'x://microsoft', properties: { mode: '' } })
    const account = core.features.call<Account[]>('account.list')[0]!
    expect(account).toMatchObject({ kind: 'microsoft', accessToken: 'fixture-minecraft-access', refreshToken: 'fixture-ms-refresh', microsoftClientId: CLIENT_ID })
    expect(user).toEqual(toOriginalUser(account))
    expect(fixture.calls.map(value => value.path)).toEqual(['/microsoft/devicecode', '/microsoft/token', '/microsoft/xbox', '/microsoft/xsts', '/microsoft/login', '/microsoft/profile'])
    expect(fixture.calls[0]!.body.client_id).toBe(CLIENT_ID)
    expect(serviceEvents(events, 'microsoft-authorize-url')[0]?.args).toEqual([fixture.base + '/verify'])
    expect(serviceEvents(events, 'device-code')[0]?.args[0]).toEqual({ userCode: 'USER-1', verificationUri: fixture.base + '/verify', expiresIn: 60, interval: 1, message: 'Local fixture authorization only' })
    expect(events.filter(value => value.channel === 'commit').at(-1)?.args).toEqual([state.id, 'userProfile', user])
    expect(JSON.stringify({ user, events })).not.toMatch(/secret-device|fixture-ms-access|fixture-ms-refresh|fixture-minecraft-access|fixture-xbox-token|fixture-xsts-token|deviceCode/)
    const flows = core.features.state('engine.accounts', createAccountsState)
    expect(flows.flows.size).toBe(0)
  })

  it('cancels only the renderer-owned real core Microsoft flow and lets another renderer complete', async () => {
    await core.features.call('settings.update', { microsoftClientId: CLIENT_ID })
    await invoke(core, 'ellan.user.state', 'ms-one')
    fixture.state.microsoftMode = 'pending'
    const one = invoke<User>(core, login.id, 'ms-one', { username: '', authority: 'x://microsoft', properties: { mode: 'device' } }).catch(error => error)
    await fixture.waitFor(value => value.path === '/microsoft/token' && value.body.device_code === 'secret-device-1')
    const two = invoke<User>(core, login.id, 'ms-two', { username: '', authority: 'x://microsoft', properties: { mode: 'device' } })
    await fixture.waitFor(value => value.path === '/microsoft/token' && value.body.device_code === 'secret-device-2')
    const flows = core.features.state('engine.accounts', createAccountsState)
    const second = [...flows.flows.values()].find(value => value.flow.deviceCode === 'secret-device-2')!
    const first = [...flows.flows.values()].find(value => value.flow.deviceCode === 'secret-device-1')!
    await expect(invoke(core, login.id, 'ms-one', { username: '', authority: 'x://microsoft' })).rejects.toMatchObject({ code: 'LOGIN_IN_PROGRESS' })
    await invoke(core, abort.id, 'unknown-renderer')
    expect(flows.flows.size).toBe(2)
    await invoke(core, abort.id, 'ms-one')
    expect(await one).toMatchObject({ code: 'REQUEST_CANCELLED', exception: { type: 'userAcquireMicrosoftTokenFailed', reason: 'USER_CANCELED' } })
    expect(first.controller.signal.aborted).toBe(true)
    expect(first.flow.deviceCode).toBe('')
    expect(second.controller.signal.aborted).toBe(false)
    expect(flows.flows.size).toBe(1)
    fixture.state.microsoftMode = 'success'
    expect((await two).authority).toBe('x://microsoft')
    expect(serviceEvents(events, 'user-login-success')).toHaveLength(1)
    expect(flows.flows.size).toBe(0)
    await invoke(core, abort.id, 'ms-one')
  })

  it('aborts the actual HTTP request before Microsoft returns a device flow', async () => {
    await core.features.call('settings.update', { microsoftClientId: CLIENT_ID })
    fixture.state.holdDeviceCode = true
    const pending = invoke<User>(core, login.id, 'begin-ui', { username: '', authority: 'x://microsoft' }).catch(error => error)
    const request = await fixture.waitFor(value => value.path === '/microsoft/devicecode')
    await invoke(core, abort.id, 'other-renderer')
    await invoke(core, abort.id, 'begin-ui')
    expect(await pending).toMatchObject({ code: 'REQUEST_CANCELLED' })
    await request.closed
    expect(core.features.state('engine.accounts', createAccountsState).flows.size).toBe(0)
    expect(core.features.call<Account[]>('account.list')).toEqual([])
    fixture.state.holdDeviceCode = false
    expect((await invoke<User>(core, login.id, 'begin-ui', { username: '', authority: 'x://microsoft' })).authority).toBe('x://microsoft')
  })

  it('aborts an in-flight token poll, scrubs core device secrets, and does not create an account', async () => {
    await core.features.call('settings.update', { microsoftClientId: CLIENT_ID })
    fixture.state.holdToken = true
    const pending = invoke<User>(core, login.id, 'poll-ui', { username: '', authority: 'x://microsoft' }).catch(error => error)
    const request = await fixture.waitFor(value => value.path === '/microsoft/token')
    const flows = core.features.state('engine.accounts', createAccountsState)
    const captured = [...flows.flows.values()][0]!
    await invoke(core, abort.id, 'poll-ui')
    expect(await pending).toMatchObject({ code: 'REQUEST_CANCELLED' })
    await request.closed
    expect(captured.controller.signal.aborted).toBe(true)
    expect(captured.flow.deviceCode).toBe('')
    expect(flows.flows.size).toBe(0)
    expect(core.features.call<Account[]>('account.list')).toEqual([])
    expect(serviceEvents(events, 'user-login-success')).toEqual([])
  })

  it('tears down actual HTTP auth when the login descriptor is disabled and releases its renderer slot', async () => {
    await core.features.call('settings.update', { microsoftClientId: CLIENT_ID })
    fixture.state.holdDeviceCode = true
    const pending = invoke<User>(core, login.id, 'disabled-ui', { username: '', authority: 'x://microsoft' }).catch(error => error)
    const request = await fixture.waitFor(value => value.path === '/microsoft/devicecode')
    await core.features.disable(login.id)
    expect(await pending).toMatchObject({ code: 'PLUGIN_CANCELLED' })
    await request.closed
    expect(core.features.state('engine.accounts', createAccountsState).flows.size).toBe(0)
    expect(core.features.call<Account[]>('account.list')).toEqual([])
    expect(serviceEvents(events, 'user-login-success')).toEqual([])
    await core.features.enable(login.id)
    const user = await invoke<User>(core, login.id, 'disabled-ui', { username: 'ReenabledFixture', authority: 'x://dev' })
    expect(user.authority).toBe('x://dev')
  })

  it('does not fabricate a Microsoft game profile when the authenticated provider returns 404', async () => {
    await core.features.call('settings.update', { microsoftClientId: CLIENT_ID })
    fixture.state.microsoftMode = 'no-profile'
    await expect(invoke(core, login.id, 'no-profile-ui', { username: '', authority: 'x://microsoft' })).rejects.toMatchObject({ code: 'PROFILE_NOT_FOUND' })
    expect(core.features.call<Account[]>('account.list')).toEqual([])
    expect(core.features.state('engine.accounts', createAccountsState).flows.size).toBe(0)
    expect(serviceEvents(events, 'user-login-success')).toEqual([])
  })

  it('authenticates Yggdrasil against the local server and refuses to remove an online profile', async () => {
    const user = await invoke<User>(core, login.id, 'ygg-ui', { username: 'fixture-login', password: 'fixture-password', authority: fixture.ygg })
    const stored = core.features.call<Account[]>('account.list')[0]!
    expect(stored).toMatchObject({ kind: 'authlib-injector', accessToken: 'fixture-ygg-access', authServerUrl: fixture.ygg })
    expect(user).toEqual(toOriginalUser(stored))
    expect(JSON.stringify({ user, events })).not.toMatch(/fixture-password|fixture-ygg-access|clientToken/)
    await expect(invoke(core, removeProfile.id, 'ygg-ui', user, user.selectedProfile)).rejects.toMatchObject({ code: 'PROFILE_REMOVAL_NOT_SUPPORTED' })
    expect(core.features.call<Account[]>('account.list')).toHaveLength(1)
    await invoke(core, remove.id, 'ygg-ui', { ...user, authority: 'x://dev', profiles: {} })
    expect(core.features.call<Account[]>('account.list')).toEqual([])
  })

  it('requires actual Yggdrasil profile selection/binding and never echoes a provider credential error', async () => {
    await expect(invoke(core, login.id, 'many-ui', { username: 'many', password: 'fixture-password', authority: fixture.ygg })).rejects.toMatchObject({ code: 'PROFILE_SELECTION_REQUIRED' })
    expect(core.features.call<Account[]>('account.list')).toEqual([])
    const bound = await invoke<User>(core, login.id, 'many-ui', { username: 'many', password: 'fixture-password', authority: fixture.ygg, properties: { profileId: OTHER_PROFILE_ID } })
    expect(bound.selectedProfile).toBe(OTHER_PROFILE_ID)
    expect(bound.profiles[OTHER_PROFILE_ID]!.name).toBe('OtherFixture')
    expect(fixture.calls.filter(value => value.path.endsWith('/refresh'))).toHaveLength(1)
    await expect(invoke(core, login.id, 'deny-ui', { username: 'deny', password: 'secret-echo-me', authority: fixture.ygg })).rejects.toMatchObject({ code: 'INVALID_CREDENTIALS', exception: { type: 'loginInvalidCredentials' } })
    expect(JSON.stringify(events)).not.toContain('secret-echo-me')
  })

  it('cancels the real Yggdrasil AbortController request without touching another renderer login', async () => {
    const pending = invoke<User>(core, login.id, 'ygg-held', { username: 'hold-one', password: 'fixture-password', authority: fixture.ygg }).catch(error => error)
    const request = await fixture.waitFor(value => value.body.username === 'hold-one')
    const other = await invoke<User>(core, login.id, 'ygg-other', { username: 'fixture-login', password: 'fixture-password', authority: fixture.ygg })
    await invoke(core, abort.id, 'ygg-held')
    expect(await pending).toMatchObject({ code: 'REQUEST_CANCELLED' })
    await request.closed
    expect(core.features.call<Account[]>('account.list').map(value => value.id)).toEqual([other.id])
    expect(serviceEvents(events, 'user-login-success')).toHaveLength(1)
  })

  it('persists only explicit actual authority URLs, advertises only implemented flows, and removes no accounts', async () => {
    await invoke(core, addAuthority.id, 'authority-ui', 'authlib-injector:' + encodeURIComponent(fixture.ygg + '/'))
    await invoke(core, addAuthority.id, 'authority-ui', fixture.ygg)
    const listed = await invoke<OriginalAuthorityMetadata[]>(core, authorities.id, 'authority-ui')
    expect(listed[2]).toMatchObject({ authority: fixture.ygg, kind: 'yggdrasil', flow: ['password'], authlibInjector: { meta: { serverName: 'Local fixture authority' } } })
    expect(listed[2]!.flow).not.toContain('device-code')
    expect(listed[2]!.flow).not.toContain('grant-code')
    expect(serviceEvents(events, 'auth-profile-added')[0]?.args).toEqual([fixture.ygg])
    const file = join(root, '.rhine', AUTHORITY_FILE)
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([fixture.ygg])
    expect(fixture.calls.every(value => value.path === '/ygg')).toBe(true)
    const user = await invoke<User>(core, login.id, 'authority-ui', { username: 'fixture-login', password: 'fixture-password', authority: fixture.ygg })
    unsubscribe()
    await core.features.dispose()
    core = await isolatedCore(root)
    unsubscribe = core.features.call<() => void>('events.subscribe', (event: EllanEvent) => events.push(event))
    const reloaded = await invoke<OriginalAuthorityMetadata[]>(core, authorities.id, 'authority-ui')
    expect(reloaded[2]).toMatchObject({ authority: fixture.ygg, kind: 'yggdrasil', flow: ['password'] })
    await invoke(core, removeAuthority.id, 'authority-ui', fixture.ygg + '/')
    expect(JSON.parse(await readFile(file, 'utf8'))).toEqual([])
    expect((await invoke<OriginalAuthorityMetadata[]>(core, authorities.id, 'authority-ui'))).toHaveLength(2)
    expect(core.features.call<Account[]>('account.list')[0]!.id).toBe(user.id)
  })

  it('rejects insecure/placeholder authorities without fetching or persisting defaults', async () => {
    for (const url of ['x://dev', 'x://microsoft', 'http://example.invalid/auth', 'https://example.invalid/auth?access_token=secret']) {
      await expect(invoke(core, addAuthority.id, 'bad-authority', url)).rejects.toMatchObject({ code: 'INVALID_AUTH_SERVER' })
    }
    expect(fixture.calls).toEqual([])
    expect((await invoke<OriginalAuthorityMetadata[]>(core, authorities.id, 'bad-authority'))).toHaveLength(2)
  })
})
