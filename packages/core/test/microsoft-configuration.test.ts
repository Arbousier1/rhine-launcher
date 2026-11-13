import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../src/plugins/boot.ts'
import type { RhContext } from '../src/contracts.ts'
import type { Settings } from '../src/types.ts'
import { MICROSOFT_AUTHORITY, microsoftConfiguration } from '../src/accounts/config.ts'
import { BUILTIN_APP_OPT_OUT, BUILTIN_MICROSOFT_APP } from '../src/accounts/builtin-app.ts'
import type { MicrosoftConfigurationStatus } from '../src/accounts/configuration.ts'
import { SECRET_ENV } from '../src/config/secrets.ts'
import configuration from '../src/plugins/features/auth/microsoft-configuration.plugin.ts'
import configure from '../src/plugins/features/auth/microsoft-configure.plugin.ts'
import { dispatchFeature, errorResponse } from '../../server/src/plugin-http.ts'

// Synthetic test-only IDs: no provider requests or borrowed application registrations.
const CLIENT_ID = '00000000-0000-0000-0000-000000000001'
const ENV_ID = '00000000-0000-0000-0000-000000000002'
const OTHER_ID = 'AAAAAAAA-BBBB-CCCC-DDDD-EEEEEEEEEEEE'
const PATH = '/api/accounts/microsoft/configuration'
const COMMON = 'https://login.microsoftonline.com/common/oauth2/v2.0'
const ORGANIZATIONS = 'https://login.microsoftonline.com/organizations/oauth2/v2.0'
const roots = new Set<string>()
const contexts: RhContext[] = []
let network: ReturnType<typeof vi.fn>

beforeEach(() => {
  // Opt out of the shipped app identity so these cases keep describing the
  // "nothing configured anywhere" contract; the built-in path has its own block.
  vi.stubEnv(SECRET_ENV.microsoftClientId, BUILTIN_APP_OPT_OUT)
  vi.stubEnv(SECRET_ENV.microsoftAuthority, undefined)
  vi.stubEnv(SECRET_ENV.curseforgeApiKey, 'test-env-api-key-not-for-output')
  network = vi.fn(() => { throw new Error('Configuration must not contact any OAuth provider') })
  vi.stubGlobal('fetch', network)
})

afterEach(async () => {
  try {
    for (const ctx of contexts.splice(0)) await ctx.features.dispose()
    // Only roots returned by this suite's mkdtemp are ever removed.
    for (const root of roots) await rm(root, { recursive: true, force: true })
    roots.clear()
    expect(network).not.toHaveBeenCalled()
  } finally {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
  }
})

async function host(existingRoot?: string) {
  const root = existingRoot ?? await mkdtemp(join(tmpdir(), 'rhine-ms-configuration-'))
  if (!existingRoot) roots.add(root)
  const ctx = await createHost(new Context(), { root })
  contexts.push(ctx)
  // Production discovery + only the two dependency closures; no login service is started.
  await ctx.features.enable(configuration.id)
  await ctx.features.enable(configure.id)
  return { ctx, root }
}

function settings(ctx: RhContext): Settings { return ctx.features.call<Settings>('settings.get') }
function seed(ctx: RhContext, patch: Partial<Settings>): Promise<Settings> {
  return ctx.features.call<Promise<Settings>>('settings.update', patch)
}
function status(ctx: RhContext): MicrosoftConfigurationStatus {
  return ctx.features.call<MicrosoftConfigurationStatus>(configuration.id)
}
async function request(ctx: RhContext, method = 'GET', body?: unknown, path = PATH): Promise<Response> {
  try {
    return await dispatchFeature(ctx.features, new Request('http://127.0.0.1' + path, {
      method, headers: { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    }))
  } catch (error) { return errorResponse(error) }
}
function expectPublic(value: Record<string, unknown>): void {
  expect(Object.keys(value).every(key => ['configured', 'source', 'managed', 'authority', 'builtin', 'optedOut', 'reason', 'message'].includes(key))).toBe(true)
  const text = JSON.stringify(value)
  for (const secret of [CLIENT_ID, ENV_ID, OTHER_ID, BUILTIN_MICROSOFT_APP.clientId, 'stored-api-key', 'stored-proxy-password', 'test-env-api-key-not-for-output', 'secret-input-value']) {
    expect(text).not.toContain(secret)
  }
}

describe('Microsoft configuration status', () => {
  it('returns plain missing configuration JSON without writing settings or honoring query overrides', async () => {
    const { ctx, root } = await host()
    const response = await request(ctx, 'GET', undefined, PATH + '?clientId=' + CLIENT_ID + '&authority=common')
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('application/json')
    const body = await response.json()
    expect(body).toMatchObject({
      configured: false, source: 'none', managed: false, authority: MICROSOFT_AUTHORITY,
      reason: 'MICROSOFT_CLIENT_ID_REQUIRED', message: expect.stringMatching(/微软登录设置/),
    })
    expectPublic(body)
    expect(() => microsoftConfiguration({}, settings(ctx))).toThrow(/微软登录设置/)
    expect(await readdir(root)).toEqual([])
  })

  it.each([
    { patch: { microsoftClientId: 'bad-saved-id', microsoftAuthority: 'common' }, configured: false, source: 'settings', authority: COMMON, reason: 'INVALID_CLIENT_ID' },
    { patch: { microsoftClientId: CLIENT_ID, microsoftAuthority: 'https://not-microsoft.invalid/token?secret-input-value' }, configured: false, source: 'settings', authority: MICROSOFT_AUTHORITY, reason: 'INVALID_AUTHORITY' },
    { patch: { microsoftClientId: CLIENT_ID, microsoftAuthority: 42 as unknown as string }, configured: false, source: 'settings', authority: MICROSOFT_AUTHORITY, reason: 'INVALID_AUTHORITY' },
    { patch: { microsoftClientId: '  ' + CLIENT_ID + '  ', microsoftAuthority: ' organizations ' }, configured: true, source: 'settings', authority: ORGANIZATIONS, reason: undefined },
    { patch: { microsoftClientId: '   ', microsoftAuthority: 'common' }, configured: false, source: 'none', authority: COMMON, reason: 'MICROSOFT_CLIENT_ID_REQUIRED' },
    { patch: { microsoftClientId: CLIENT_ID, microsoftAuthority: '   ' }, configured: true, source: 'settings', authority: MICROSOFT_AUTHORITY, reason: undefined },
  ])('uses real validation for saved configuration: $source / $configured / $reason', async ({ patch, configured, source, authority, reason }) => {
    const { ctx, root } = await host()
    await seed(ctx, patch)
    const before = await readFile(join(root, 'launcher.json'), 'utf8')
    const response = await request(ctx)
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ configured, source, managed: false, authority })
    expect(body.reason).toBe(reason)
    if (configured) expect(microsoftConfiguration({}, settings(ctx)).authority).toBe(authority)
    else expect(() => microsoftConfiguration({}, settings(ctx))).toThrow()
    expectPublic(body)
    expect(await readFile(join(root, 'launcher.json'), 'utf8')).toBe(before)
  })

  it('prefers valid environment values without exposing or persisting an environment ID', async () => {
    const { ctx, root } = await host()
    await seed(ctx, { microsoftClientId: 'invalid-local', microsoftAuthority: 'https://invalid.local/token' })
    const before = await readFile(join(root, 'launcher.json'), 'utf8')
    vi.stubEnv(SECRET_ENV.microsoftClientId, '  ' + ENV_ID + '  ')
    vi.stubEnv(SECRET_ENV.microsoftAuthority, 'organizations')
    const body = await (await request(ctx)).json()
    expect(body).toMatchObject({ configured: true, source: 'env', managed: true, authority: ORGANIZATIONS })
    expect(microsoftConfiguration({}, settings(ctx)).clientId).toBe(ENV_ID)
    expectPublic(body)
    expect(await readFile(join(root, 'launcher.json'), 'utf8')).toBe(before)
  })

  it('reports an invalid environment ID as managed and invalid, not as configured', async () => {
    const { ctx } = await host()
    await seed(ctx, { microsoftClientId: CLIENT_ID })
    vi.stubEnv(SECRET_ENV.microsoftClientId, 'invalid-environment-id')
    const body = await (await request(ctx)).json()
    expect(body).toMatchObject({ configured: false, source: 'env', managed: true, reason: 'INVALID_CLIENT_ID', authority: MICROSOFT_AUTHORITY })
    expect(body.message).toMatch(/RHINE_MICROSOFT_CLIENT_ID.*发布方/)
    expect(JSON.stringify(body)).not.toContain('invalid-environment-id')
    expectPublic(body)
  })

  it('treats blank environment values as unset and keeps a local configuration editable', async () => {
    const { ctx } = await host()
    await seed(ctx, { microsoftClientId: CLIENT_ID, microsoftAuthority: 'common' })
    vi.stubEnv(SECRET_ENV.microsoftClientId, '   ')
    vi.stubEnv(SECRET_ENV.microsoftAuthority, '')
    expect(status(ctx)).toMatchObject({ configured: true, source: 'settings', managed: false, authority: COMMON })
    expect((await request(ctx, 'PUT', { clientId: OTHER_ID })).status).toBe(200)
    expect(settings(ctx).microsoftClientId).toBe(OTHER_ID)
  })

  it('surfaces an invalid authority environment even when the client ID is also missing', async () => {
    const { ctx } = await host()
    vi.stubEnv(SECRET_ENV.microsoftAuthority, 'https://invalid.local/token?secret-input-value')
    const body = await (await request(ctx)).json()
    expect(body).toMatchObject({ configured: false, source: 'none', managed: false, authority: MICROSOFT_AUTHORITY, reason: 'MICROSOFT_CLIENT_ID_REQUIRED' })
    expect(body.message).toMatch(/RHINE_MICROSOFT_AUTHORITY.*发布方/)
    expectPublic(body)
  })
})

describe('shipped Microsoft app identity', () => {
  it('uses the built-in identity when nothing is saved, while keeping it out of the payload', async () => {
    const { ctx } = await host()
    vi.stubEnv(SECRET_ENV.microsoftClientId, undefined)
    const body = await (await request(ctx)).json()
    expect(body).toMatchObject({ configured: true, source: 'builtin', managed: false, builtin: true, optedOut: false, authority: MICROSOFT_AUTHORITY })
    expect(body.reason).toBeUndefined()
    // The built-in id is public, but the status stays metadata-only.
    expectPublic(body)
    expect(microsoftConfiguration({}, settings(ctx)).clientId).toBe(BUILTIN_MICROSOFT_APP.clientId)
  })
  it('lets an explicit saved value override the built-in identity', async () => {
    const { ctx } = await host()
    vi.stubEnv(SECRET_ENV.microsoftClientId, undefined)
    await seed(ctx, { microsoftClientId: CLIENT_ID })
    expect(status(ctx)).toMatchObject({ configured: true, source: 'settings', builtin: false })
    expect(microsoftConfiguration({}, settings(ctx)).clientId).toBe(CLIENT_ID)
  })

  it('prefers the environment over the built-in identity', async () => {
    const { ctx } = await host()
    vi.stubEnv(SECRET_ENV.microsoftClientId, ENV_ID)
    const body = await (await request(ctx)).json()
    expect(body).toMatchObject({ configured: true, source: 'env', managed: true, builtin: false })
    expect(microsoftConfiguration({}, settings(ctx)).clientId).toBe(ENV_ID)
  })

  it('clearing a saved override falls back to the built-in identity instead of breaking login', async () => {
    const { ctx } = await host()
    vi.stubEnv(SECRET_ENV.microsoftClientId, undefined)
    await seed(ctx, { microsoftClientId: OTHER_ID })
    const body = await (await request(ctx, 'PUT', { clientId: '' })).json()
    expect(body).toMatchObject({ configured: true, source: 'builtin', builtin: true, authority: MICROSOFT_AUTHORITY })
    expectPublic(body)
    expect(microsoftConfiguration({}, settings(ctx)).clientId).toBe(BUILTIN_MICROSOFT_APP.clientId)
  })

  it.each(['off', ' OFF '])('honours the %j opt-out so a distributor ships no registration', async (value) => {
    const { ctx } = await host()
    vi.stubEnv(SECRET_ENV.microsoftClientId, value)
    const body = await (await request(ctx)).json()
    expect(body).toMatchObject({ configured: false, source: 'none', builtin: false, optedOut: true, reason: 'MICROSOFT_CLIENT_ID_REQUIRED' })
    expect(body.message).toMatch(/off/)
    expectPublic(body)
    expect(() => microsoftConfiguration({}, settings(ctx))).toThrow(/微软登录设置/)
  })
})

describe('Microsoft configuration writes', () => {
  it('persists trimmed validated values through settings.update without changing other settings or accounts', async () => {
    const { ctx, root } = await host()
    await seed(ctx, {
      language: 'en-US', concurrency: 3, keepLogs: 6, curseforgeApiKey: 'stored-api-key',
      proxy: { enabled: true, host: '127.0.0.1', port: 7891, username: 'test-user', password: 'stored-proxy-password' },
    })
    await ctx.features.enable('auth.offline.login')
    await ctx.features.enable('account.list')
    await ctx.features.call('auth.offline.login', { name: 'Unchanged' })
    const accountsBefore = await readFile(join(root, 'accounts.json'), 'utf8')
    const accountSnapshot = ctx.accounts.list()
    const before = structuredClone(settings(ctx))
    const calls = vi.spyOn(ctx.features, 'call')
    const response = await request(ctx, 'PUT', { clientId: '  ' + OTHER_ID + '  ', authority: ' https://login.microsoftonline.com/common/oauth2/v2.0/ ' })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ configured: true, source: 'settings', managed: false, authority: COMMON, builtin: false, optedOut: true })
    expectPublic(body)
    const expectedPatch = { microsoftClientId: OTHER_ID, microsoftAuthority: COMMON }
    expect(calls.mock.calls.filter(([id]) => id === 'settings.update').map(([, input]) => input)).toEqual([expectedPatch])
    expect(settings(ctx)).toEqual({ ...before, ...expectedPatch })
    expect(JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8'))).toEqual({ ...before, ...expectedPatch })
    expect(await readFile(join(root, 'accounts.json'), 'utf8')).toBe(accountsBefore)
    expect(ctx.accounts.list()).toEqual(accountSnapshot)
    expect(ctx.paths.get().root).toBe(root)
    expect(ctx.features.has('auth.microsoft.begin')).toBe(false)
    await ctx.features.dispose()
    const reopened = await host(root)
    expect(status(reopened.ctx)).toEqual(body)
    expect(settings(reopened.ctx)).toEqual({ ...before, ...expectedPatch })
    expect(await readFile(join(root, 'accounts.json'), 'utf8')).toBe(accountsBefore)
  })

  it.each([undefined, ' organizations ', COMMON + '/'])('preserves an omitted authority exactly (%s)', async (savedAuthority) => {
    const { ctx, root } = await host()
    await seed(ctx, { microsoftClientId: CLIENT_ID, microsoftAuthority: savedAuthority })
    const before = structuredClone(settings(ctx))
    const response = await request(ctx, 'PUT', { clientId: OTHER_ID })
    expect(response.status).toBe(200)
    expect(settings(ctx)).toEqual({ ...before, microsoftClientId: OTHER_ID })
    expect(JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8')).microsoftAuthority).toBe(savedAuthority)
    expect((await response.json()).authority).toBe(microsoftConfiguration({}, settings(ctx)).authority)
  })

  it.each(['', '   '])('clears only an unmanaged local override (%j), including invalid old configuration', async (clientId) => {
    const { ctx, root } = await host()
    await seed(ctx, { microsoftClientId: 'invalid-local-id', microsoftAuthority: 'https://invalid.local/token', keepLogs: 7 })
    const before = structuredClone(settings(ctx))
    const response = await request(ctx, 'PUT', { clientId })
    const body = await response.json()
    expect(response.status).toBe(200)
    expect(body).toMatchObject({ configured: false, source: 'none', managed: false, authority: MICROSOFT_AUTHORITY, reason: 'MICROSOFT_CLIENT_ID_REQUIRED' })
    expectPublic(body)
    expect(settings(ctx)).toEqual({ ...before, microsoftClientId: '' })
    await ctx.features.dispose()
    const reopened = await host(root)
    expect(settings(reopened.ctx)).toEqual({ ...before, microsoftClientId: '' })
    expect(status(reopened.ctx)).toEqual(body)
  })

  it.each([
    { environment: ENV_ID, clientId: CLIENT_ID }, { environment: ENV_ID, clientId: '' },
    { environment: 'invalid-environment-id', clientId: CLIENT_ID }, { environment: 'invalid-environment-id', clientId: '' },
  ])('rejects environment-managed writes and clears ($environment, $clientId) with actionable 409', async ({ environment, clientId }) => {
    const { ctx, root } = await host()
    await seed(ctx, { microsoftClientId: OTHER_ID, microsoftAuthority: 'common' })
    const before = await readFile(join(root, 'launcher.json'), 'utf8')
    vi.stubEnv(SECRET_ENV.microsoftClientId, environment)
    const calls = vi.spyOn(ctx.features, 'call')
    const response = await request(ctx, 'PUT', { clientId, authority: 'consumers' })
    expect(response.status).toBe(409)
    const body = await response.json()
    expect(body).toEqual({ code: 'MICROSOFT_CONFIGURATION_MANAGED', message: expect.stringMatching(/RHINE_MICROSOFT_CLIENT_ID.*发布方/) })
    expect(JSON.stringify(body)).not.toContain(environment)
    expect(calls.mock.calls.some(([id]) => id === 'settings.update')).toBe(false)
    expect(await readFile(join(root, 'launcher.json'), 'utf8')).toBe(before)
  })

  it.each([undefined, 'organizations', ORGANIZATIONS + '/'])('respects environment authority without persisting it (%s)', async (authority) => {
    const { ctx, root } = await host()
    await seed(ctx, { microsoftClientId: CLIENT_ID, microsoftAuthority: 'common' })
    const before = structuredClone(settings(ctx))
    vi.stubEnv(SECRET_ENV.microsoftAuthority, ' organizations ')
    const response = await request(ctx, 'PUT', { clientId: OTHER_ID, authority })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ configured: true, source: 'settings', managed: false, authority: ORGANIZATIONS })
    expect(settings(ctx)).toEqual({ ...before, microsoftClientId: OTHER_ID })
    expect(JSON.parse(await readFile(join(root, 'launcher.json'), 'utf8')).microsoftAuthority).toBe('common')
  })

  it('rejects a conflicting supplied authority while an environment authority is active', async () => {
    const { ctx, root } = await host()
    await seed(ctx, { microsoftClientId: CLIENT_ID })
    const before = await readFile(join(root, 'launcher.json'), 'utf8')
    vi.stubEnv(SECRET_ENV.microsoftAuthority, 'organizations')
    const response = await request(ctx, 'PUT', { clientId: OTHER_ID, authority: 'common' })
    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ code: 'MICROSOFT_AUTHORITY_MANAGED', message: expect.stringMatching(/RHINE_MICROSOFT_AUTHORITY.*省略 authority/) })
    expect(await readFile(join(root, 'launcher.json'), 'utf8')).toBe(before)
  })

  it('reports invalid environment authority safely and refuses to save an unusable nonempty ID', async () => {
    const { ctx, root } = await host()
    await seed(ctx, { microsoftClientId: CLIENT_ID, microsoftAuthority: 'common' })
    const before = await readFile(join(root, 'launcher.json'), 'utf8')
    vi.stubEnv(SECRET_ENV.microsoftAuthority, 'https://not-microsoft.invalid/token?secret-input-value')
    expect(status(ctx)).toMatchObject({ configured: false, source: 'settings', managed: false, authority: MICROSOFT_AUTHORITY, reason: 'INVALID_AUTHORITY', message: expect.stringMatching(/RHINE_MICROSOFT_AUTHORITY.*发布方/) })
    const response = await request(ctx, 'PUT', { clientId: OTHER_ID })
    expect(response.status).toBe(400)
    expect(await response.json()).toEqual({ code: 'INVALID_AUTHORITY', message: expect.stringMatching(/RHINE_MICROSOFT_AUTHORITY.*发布方/) })
    expect(await readFile(join(root, 'launcher.json'), 'utf8')).toBe(before)
  })

  it('does not blame a valid environment authority for an invalid supplied one', async () => {
    const { ctx } = await host()
    vi.stubEnv(SECRET_ENV.microsoftAuthority, 'organizations')
    const response = await request(ctx, 'PUT', { clientId: CLIENT_ID, authority: 'https://invalid.local/token' })
    expect(response.status).toBe(400)
    const body = await response.json()
    expect(body.code).toBe('INVALID_AUTHORITY')
    expect(body.message).not.toContain('RHINE_MICROSOFT_AUTHORITY 无效')
  })

  it.each([
    { label: 'invalid GUID', body: { clientId: 'not-a-guid' }, code: 'INVALID_CLIENT_ID' },
    { label: 'compact GUID', body: { clientId: CLIENT_ID.replaceAll('-', '') }, code: 'INVALID_CLIENT_ID' },
    { label: 'missing clientId', body: {}, code: 'INVALID_REQUEST' },
    { label: 'non-string clientId', body: { clientId: 42 }, code: 'INVALID_REQUEST' },
    { label: 'null authority', body: { clientId: CLIENT_ID, authority: null }, code: 'INVALID_AUTHORITY' },
    ...['accessToken', 'refreshToken', 'deviceCode', 'password', 'clientSecret', 'apiKey', 'curseforgeApiKey', 'dataDir', 'microsoftClientId', '__proto__'].map(key => ({ label: 'extra ' + key, body: { clientId: CLIENT_ID, [key]: 'secret-input-value' }, code: 'INVALID_REQUEST' })),
    ...[
      'https://not-microsoft.invalid/consumers/oauth2/v2.0', 'http://login.microsoftonline.com/consumers/oauth2/v2.0',
      'https://login.microsoftonline.com.evil.invalid/consumers/oauth2/v2.0',
      'https://user:secret-input-value@login.microsoftonline.com/consumers/oauth2/v2.0',
      MICROSOFT_AUTHORITY + '?secret-input-value', MICROSOFT_AUTHORITY + '#secret-input-value',
      MICROSOFT_AUTHORITY + '/token', 'https://login.microsoftonline.com:444/consumers/oauth2/v2.0', '',
    ].map(authority => ({ label: 'invalid authority ' + authority, body: { clientId: CLIENT_ID, authority }, code: 'INVALID_AUTHORITY' })),
  ])('rejects $label without persistence or secret echo', async ({ body, code }) => {
    const { ctx, root } = await host()
    await seed(ctx, { microsoftClientId: OTHER_ID, microsoftAuthority: 'common', keepLogs: 8 })
    const before = await readFile(join(root, 'launcher.json'), 'utf8')
    const calls = vi.spyOn(ctx.features, 'call')
    const response = await request(ctx, 'PUT', body)
    expect(response.status).toBe(400)
    const error = await response.json()
    expect(error).toEqual({ code, message: expect.any(String) })
    expect(JSON.stringify(error)).not.toContain('secret-input-value')
    expect(calls.mock.calls.some(([id]) => id === 'settings.update')).toBe(false)
    expect(await readFile(join(root, 'launcher.json'), 'utf8')).toBe(before)
  })

  it('validates native calls as well as HTTP decoding', async () => {
    const { ctx, root } = await host()
    for (const input of [undefined, null, [], 'bad', { clientId: CLIENT_ID, password: 'secret-input-value' }, Object.create({ clientId: CLIENT_ID })]) {
      await expect(ctx.features.call(configure.id, input)).rejects.toMatchObject({ name: 'AccountError', code: 'INVALID_REQUEST', statusCode: 400 })
    }
    expect(await readdir(root)).toEqual([])
  })
})

describe('independently discovered configuration plugins', () => {
  it('discovers one operation per descriptor and keeps GET alive after PUT or settings.update is disabled', async () => {
    const { ctx } = await host()
    expect(ctx.features.definition(configuration.id)).toMatchObject({ id: configuration.id, capability: configuration.id, depends: ['settings.get'], http: { method: 'GET', path: PATH } })
    expect(ctx.features.definition(configure.id)).toMatchObject({ id: configure.id, capability: configure.id, depends: ['settings.get', 'settings.update'], http: { method: 'PUT', path: PATH } })
    await ctx.features.disable(configure.id)
    expect((await request(ctx)).status).toBe(200)
    expect((await request(ctx, 'PUT', { clientId: CLIENT_ID })).status).toBe(503)
    await ctx.features.enable(configure.id)
    await ctx.features.disable('settings.update')
    expect((await request(ctx)).status).toBe(200)
    expect((await request(ctx, 'PUT', { clientId: CLIENT_ID })).status).toBe(503)
  })

  it('keeps PUT independent of GET and of Microsoft login operations', async () => {
    const { ctx } = await host()
    await ctx.features.disable(configuration.id)
    expect(ctx.features.has(configure.id)).toBe(true)
    const response = await request(ctx, 'PUT', { clientId: CLIENT_ID })
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ configured: true, source: 'settings', managed: false, authority: MICROSOFT_AUTHORITY })
    expect((await request(ctx)).status).toBe(503)
    expect(ctx.features.has('auth.microsoft.begin')).toBe(false)
    expect(ctx.features.has('auth.microsoft.complete')).toBe(false)
    expect(ctx.features.has('auth.microsoft.refresh')).toBe(false)
    expect((await request(ctx, 'POST', { clientId: CLIENT_ID })).status).toBe(404)
    expect((await request(ctx, 'PATCH', { clientId: CLIENT_ID })).status).toBe(404)
  })
})
