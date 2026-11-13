import { join } from 'node:path'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { toOriginalUser } from '@rhine/ellan-ui/projections'
import type { Account, Settings } from '../types.ts'
import type { RhPaths } from '../contracts.ts'
import { AccountError, throwIfAborted } from '../accounts/errors.ts'
import { ACCOUNT_WRITE_DEPENDS, accountRepository, accountsState } from '../accounts/environment.ts'
import { authenticateYggdrasil, validateAuthServerUrl, yggdrasilAccountId } from '../accounts/authlib-injector.ts'
import { microsoftConfiguration, microsoftEndpoints } from '../accounts/config.ts'
import { finishMicrosoftFlow, storeMicrosoftFlow } from '../accounts/flows.ts'
import { parseDeviceCode, oauthErrorHint, tokenErrorCode, type DeviceCodeBody, type TokenBody } from '../accounts/microsoft.ts'
import { abortableDelay, FORM_HEADERS, formEncode, requestJson } from '../accounts/http.ts'
import { compactUuid, expandUuid, offlineUuid } from '../accounts/uuid.ts'
import { type OriginalCall, record, text } from './feature.ts'
import { emitOriginal, store } from './state.ts'

// Protocol/repository helpers above expose no plugins or original runtime services.
// Begin needs a renderer-owned signal (env.use inherits only the feature signal).
// Completion uses the real core capability and its explicitly bound device flow.
export const LOGIN_DEPENDS = [...ACCOUNT_WRITE_DEPENDS, 'settings.get', 'auth.offline.login', 'auth.microsoft.complete', 'events.emit'] as const
export const ABORT_LOGIN_DEPENDS = ['auth.microsoft.cancel'] as const
export const USER_REMOVE_DEPENDS = ['account.get', 'account.remove', 'events.emit'] as const
export const PROFILE_SELECT_DEPENDS = ['account.get', 'events.emit'] as const
export const PROFILE_REMOVE_DEPENDS = USER_REMOVE_DEPENDS
export const AUTHORITY_READ_DEPENDS = ['paths.get', 'storage.read', 'settings.get'] as const
export const AUTHORITY_WRITE_DEPENDS = ['paths.get', 'storage.read', 'storage.write'] as const
export const AUTHORITY_ADD_DEPENDS = [...AUTHORITY_WRITE_DEPENDS, 'events.emit'] as const
export const AUTHORITY_FILE = 'ellan-authorities.json'

export interface OriginalLoginOptions {
  username: string
  password?: string
  authority: string
  properties?: Record<string, string>
}
export interface OriginalAuthorityMetadata {
  authority: string
  kind: 'builtin' | 'yggdrasil'
  flow: Array<'device-code' | 'password' | 'anonymous'>
  emailOnly?: boolean
  configured?: boolean
  authlibInjector?: {
    meta: {
      serverName: string; implementationName: string; implementationVersion: string
      links: { homepage: string; register: string }
      'feature.non_email_login': boolean
    }
    skinDomains: string[]
    signaturePublickey: string
  }
}
type OriginalUser = ReturnType<typeof toOriginalUser>
interface Login { controller: AbortController; flowId?: string }
interface Logins { active: Map<string, Login> }
function logins(env: FeatureEnvironment): Logins {
  return env.state<Logins>('ellan.accounts.logins', () => ({ active: new Map() }), value => {
    for (const login of value.active.values()) login.controller.abort()
    value.active.clear()
  })
}

export function originalLoginOptions(value: unknown): OriginalLoginOptions {
  const input = record(value, 'LoginOptions')
  if (typeof input.username !== 'string' || input.username.length > 4096 || /[\u0000-\u001f\u007f]/.test(input.username)) throw new AccountError('LoginOptions.username must be a string without control characters', 'INVALID_REQUEST')
  if (input.password !== undefined && (typeof input.password !== 'string' || input.password.length > 4096)) throw new AccountError('LoginOptions.password must be a string', 'INVALID_REQUEST')
  let properties: Record<string, string> | undefined
  if (input.properties !== undefined) {
    const source = record(input.properties, 'LoginOptions.properties')
    if (Object.values(source).some(value => typeof value !== 'string' || value.length > 4096)) throw new AccountError('LoginOptions.properties must contain strings', 'INVALID_REQUEST')
    properties = { ...source } as Record<string, string>
  }
  return { username: input.username, password: input.password as string | undefined, authority: text(input.authority, 'authority'), properties }
}
function emitService(env: FeatureEnvironment, event: string, payload: unknown) {
  if (!env.signal.aborted) emitOriginal(env, 'service-event', [{ service: 'UserService', event, args: [payload] }])
}
function validating(env: FeatureEnvironment) {
  const state = store(env).states.get('UserState')
  if (state && !env.signal.aborted) emitOriginal(env, 'state-validating', [{ id: state.id, semaphore: logins(env).active.size }])
}
function commitUser(env: FeatureEnvironment, user: OriginalUser) {
  const state = store(env).states.get('UserState')
  if (!state) return
  const users = state.snapshot.users as Record<string, OriginalUser>
  users[user.id] = structuredClone(user)
  emitOriginal(env, 'commit', [state.id, 'userProfile', user])
}
function commitRemoval(env: FeatureEnvironment, id: string) {
  const state = store(env).states.get('UserState')
  if (!state) return
  delete (state.snapshot.users as Record<string, OriginalUser>)[id]
  emitOriginal(env, 'commit', [state.id, 'userProfileRemove', id])
}
function loginException(error: unknown, authority: string) {
  const safe = error instanceof AccountError ? error : new AccountError('Account login failed; check the configured provider and try again', 'LOGIN_FAILED')
  const cancelled = ['REQUEST_CANCELLED', 'FLOW_CANCELLED', 'PLUGIN_CANCELLED'].includes(safe.code)
  const exception = safe.code === 'INVALID_CREDENTIALS' ? { type: 'loginInvalidCredentials' }
    : safe.code === 'NETWORK_ERROR' || safe.code === 'UPSTREAM_UNAVAILABLE' ? { type: 'loginInternetNotConnected' }
    : safe.code === 'LOGIN_SERVICE_NOT_SUPPORTED' ? { type: 'loginServiceNotSupported', authority }
    : cancelled && authority === 'x://microsoft' ? { type: 'userAcquireMicrosoftTokenFailed', reason: 'USER_CANCELED' }
    : { type: 'loginGeneral' }
  return Object.assign(safe, { name: 'UserException', exception })
}

async function microsoftLogin(options: OriginalLoginOptions, entry: Login, env: FeatureEnvironment, signal: AbortSignal): Promise<Account> {
  if (options.properties?.mode && options.properties.mode !== 'device') throw new AccountError('This host supports Microsoft device-code login only, not browser grant-code/password/native-broker login', 'LOGIN_FLOW_NOT_SUPPORTED')
  const settings = await env.use<Settings | Promise<Settings>>('settings.get')
  const config = microsoftConfiguration({}, settings)
  const response = await requestJson<DeviceCodeBody & TokenBody>(microsoftEndpoints(config).deviceCode, {
    method: 'POST', headers: FORM_HEADERS, body: formEncode({ client_id: config.clientId, scope: 'XboxLive.signin offline_access' }),
  }, '请求微软登录设备码', signal)
  const code = tokenErrorCode(response.body)
  if (response.status < 200 || response.status >= 300 || code) {
    const failure = code ?? 'DEVICE_CODE_FAILED'
    throw new AccountError('无法启动微软登录：' + oauthErrorHint(failure) + '（' + failure + '）', failure)
  }
  const device = parseDeviceCode(response.body)
  if (!device) throw new AccountError('微软返回的设备码信息不完整，请重试', 'DEVICE_CODE_INVALID')
  throwIfAborted(signal)
  const state = accountsState(env)
  const flow = storeMicrosoftFlow(state, device, config)
  entry.flowId = flow.flowId
  const cancel = () => finishMicrosoftFlow(state, flow.flowId, 'FLOW_CANCELLED')
  signal.addEventListener('abort', cancel, { once: true })
  try {
    throwIfAborted(signal)
    emitService(env, 'microsoft-authorize-url', flow.verificationUri)
    // The original form reads userCode/verificationUri. Never broadcast the secret
    // deviceCode, nor Microsoft/Xbox/Minecraft access or refresh tokens.
    emitService(env, 'device-code', {
      userCode: flow.userCode, verificationUri: flow.verificationUri,
      expiresIn: Math.max(0, Math.ceil((flow.expiresAt - Date.now()) / 1000)), interval: flow.intervalMs / 1000,
      message: typeof response.body?.message === 'string' ? response.body.message : '',
    })
    for (;;) {
      throwIfAborted(signal)
      try {
        return await env.use<Promise<Account>>('auth.microsoft.complete', { flowId: flow.flowId })
      } catch (error) {
        throwIfAborted(signal)
        if (!(error instanceof AccountError) || !['authorization_pending', 'slow_down'].includes(error.code)) throw error
        const wait = error.retryAfterMs ?? error.intervalMs ?? flow.intervalMs
        await abortableDelay(Math.max(1, Math.min(wait, Math.max(1, flow.expiresAt - Date.now()))), signal)
      }
    }
  } finally {
    signal.removeEventListener('abort', cancel)
    // Also expire terminal failures/teardown; successful complete already removed it.
    finishMicrosoftFlow(state, flow.flowId, 'FLOW_CANCELLED')
    entry.flowId = undefined
  }
}

export async function loginUser(input: OriginalCall, env: FeatureEnvironment): Promise<OriginalUser> {
  const options = originalLoginOptions(input.args[0])
  const registry = logins(env)
  if (registry.active.has(input.rendererId)) throw new AccountError('A login is already running for this renderer; abort it before starting another', 'LOGIN_IN_PROGRESS', { status: 409 })
  const entry: Login = { controller: new AbortController() }
  const signal = AbortSignal.any([env.signal, entry.controller.signal])
  registry.active.set(input.rendererId, entry)
  try {
    validating(env)
    emitService(env, 'user-login', options.authority)
    throwIfAborted(signal)
    let account: Account
    if (options.authority === 'x://dev') {
      const custom = options.properties?.uuid
      if (custom && expandUuid(custom) !== offlineUuid(options.username.trim())) throw new AccountError('Core offline accounts use the Minecraft name-derived UUID; custom UUID profiles are not supported', 'CUSTOM_OFFLINE_UUID_NOT_SUPPORTED')
      account = await env.use<Promise<Account>>('auth.offline.login', { name: options.username })
    } else if (options.authority === 'x://microsoft') {
      account = await microsoftLogin(options, entry, env, signal)
    } else {
      if (options.authority.startsWith('x:')) throw new AccountError('This account authority is not supported by the configured core', 'LOGIN_SERVICE_NOT_SUPPORTED')
      if (options.properties?.mode) throw new AccountError('Core Yggdrasil authorities support password login only, not device-code or browser grant-code login', 'LOGIN_FLOW_NOT_SUPPORTED')
      const authServerUrl = validateAuthServerUrl(options.authority)
      const fresh = await authenticateYggdrasil(authServerUrl, options.username, options.password ?? '', { signal, profileId: options.properties?.profileId || undefined })
      throwIfAborted(signal)
      account = await accountRepository(env).upsert({
        id: yggdrasilAccountId(authServerUrl, fresh.profile.id), kind: 'authlib-injector', name: fresh.profile.name,
        uuid: expandUuid(fresh.profile.id)!, authServerUrl, accessToken: fresh.accessToken, clientToken: fresh.clientToken,
      })
    }
    const user = toOriginalUser(account)
    commitUser(env, user)
    emitService(env, 'user-login-success', user)
    return user
  } catch (error) {
    const failure = loginException(error, options.authority)
    emitService(env, 'error', { name: failure.name, code: failure.code, message: failure.message, exception: failure.exception })
    throw failure
  } finally {
    if (registry.active.get(input.rendererId) === entry) registry.active.delete(input.rendererId)
    validating(env)
  }
}

export function abortLogin(input: OriginalCall, env: FeatureEnvironment): void {
  const entry = logins(env).active.get(input.rendererId)
  if (!entry) return
  // Never use latestFlowId: a second renderer may be signing in independently.
  if (entry.flowId) env.use('auth.microsoft.cancel', { flowId: entry.flowId })
  entry.controller.abort()
}
async function actualUser(value: unknown, env: FeatureEnvironment): Promise<Account> {
  const id = text(record(value, 'UserProfile').id, 'user id')
  const account = await env.use<Account | undefined | Promise<Account | undefined>>('account.get', { id })
  if (!account) throw new AccountError('Account is not registered in this launcher', 'ACCOUNT_NOT_FOUND')
  return account
}
export async function removeUser(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const account = await actualUser(input.args[0], env)
  await env.use<Promise<void>>('account.remove', { id: account.id })
  commitRemoval(env, account.id)
}
function actualProfile(account: Account, value: unknown): string {
  const requested = expandUuid(text(value, 'game profile id'))
  if (!requested || requested !== expandUuid(account.uuid)) throw new AccountError('The requested game profile is not stored on this account; core stores one authenticated profile per account', 'PROFILE_NOT_FOUND')
  return compactUuid(requested)
}
export async function selectUserProfile(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const account = await actualUser(input.args[0], env)
  actualProfile(account, input.args[1])
  // Selection of the sole real profile is idempotent. Do not trust renderer
  // profiles or rebind an online token to a different, unverified game UUID.
  commitUser(env, toOriginalUser(account))
}
export async function removeUserProfile(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const account = await actualUser(input.args[0], env)
  actualProfile(account, input.args[1])
  if (account.kind !== 'offline') throw new AccountError('Removing online game profiles is not supported; remove the account instead', 'PROFILE_REMOVAL_NOT_SUPPORTED')
  // The offline record is its only profile. Removing it must remove the actual
  // persisted account rather than leaving a fake renderer-only empty profile.
  await env.use<Promise<void>>('account.remove', { id: account.id })
  commitRemoval(env, account.id)
}

interface Authorities { file?: string; urls?: string[]; loading?: Promise<void>; writes: Promise<void>; metadata: Map<string, OriginalAuthorityMetadata['authlibInjector']> }
function authorityStore(env: FeatureEnvironment): Authorities {
  return env.state<Authorities>('ellan.accounts.authorities', () => ({ writes: Promise.resolve(), metadata: new Map() }))
}
async function authorities(env: FeatureEnvironment): Promise<Authorities> {
  const state = authorityStore(env)
  if (!state.loading) state.loading = (async () => {
    state.file = join(env.use<RhPaths>('paths.get').root, '.rhine', AUTHORITY_FILE)
    const saved = await env.use<Promise<unknown>>('storage.read', { file: state.file, fallback: [] })
    if (!Array.isArray(saved) || saved.some(value => typeof value !== 'string')) throw new AccountError('Authority storage must contain an explicit URL array; it was not overwritten', 'AUTHORITY_STORAGE_INVALID')
    state.urls = [...new Set(saved.map(value => validateAuthServerUrl(value)))]
  })().catch(error => { state.loading = undefined; throw error })
  await state.loading
  return state
}
export async function supportedAuthorities(_input: OriginalCall, env: FeatureEnvironment): Promise<OriginalAuthorityMetadata[]> {
  const state = await authorities(env)
  const settings = await env.use<Settings | Promise<Settings>>('settings.get')
  let configured = false
  try { microsoftConfiguration({}, settings); configured = true } catch (error) { if (!(error instanceof AccountError)) throw error }
  return [
    { authority: 'x://dev', kind: 'builtin', flow: ['anonymous'] },
    { authority: 'x://microsoft', kind: 'builtin', flow: ['device-code'], emailOnly: true, configured },
    ...state.urls!.map(authority => ({ authority, kind: 'yggdrasil' as const, flow: ['password' as const], authlibInjector: state.metadata.get(authority) })),
  ]
}
function metadataText(value: unknown, max = 4096): string {
  return typeof value === 'string' && value.length <= max && !/[\u0000-\u001f\u007f]/.test(value) ? value : ''
}
function metadataLink(value: unknown): string {
  const source = metadataText(value)
  if (!source) return ''
  try { return validateAuthServerUrl(source) } catch { return '' }
}
function parseMetadata(value: unknown): NonNullable<OriginalAuthorityMetadata['authlibInjector']> {
  const body = record(value, 'authlib-injector metadata')
  const meta = record(body.meta, 'authlib-injector meta')
  const links = meta.links && typeof meta.links === 'object' && !Array.isArray(meta.links) ? meta.links as Record<string, unknown> : {}
  return {
    meta: {
      serverName: metadataText(meta.serverName, 256), implementationName: metadataText(meta.implementationName, 256), implementationVersion: metadataText(meta.implementationVersion, 256),
      links: { homepage: metadataLink(links.homepage), register: metadataLink(links.register) },
      'feature.non_email_login': meta['feature.non_email_login'] === true,
    },
    skinDomains: Array.isArray(body.skinDomains) ? body.skinDomains.filter((value): value is string => typeof value === 'string' && /^[A-Za-z0-9.*_-]{1,253}$/.test(value)).slice(0, 128) : [],
    signaturePublickey: typeof body.signaturePublickey === 'string' && body.signaturePublickey.length <= 32768 ? body.signaturePublickey : '',
  }
}
function authorityUrl(value: unknown): string {
  let url = text(value, 'Yggdrasil service URL')
  // Original add-service input accepts these explicit protocol links. Do not
  // infer domains, known providers, OAuth endpoints, or a local auth server.
  for (const prefix of ['authlib-injector:', 'yggdrasil-server:']) if (url.startsWith(prefix)) {
    try { url = decodeURIComponent(url.slice(prefix.length)) } catch { throw new AccountError('Invalid encoded authority URL', 'INVALID_AUTH_SERVER') }
    break
  }
  return validateAuthServerUrl(url)
}
export async function addAuthority(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const url = authorityUrl(input.args[0])
  const response = await requestJson<unknown>(url, { headers: { accept: 'application/json' } }, '读取外置认证元数据', env.signal)
  if (response.status < 200 || response.status >= 300) throw new AccountError('The explicit authority did not return authlib-injector metadata', 'AUTHORITY_METADATA_INVALID')
  const metadata = parseMetadata(response.body)
  const state = await authorities(env)
  const run = state.writes.then(async () => {
    const next = [...new Set([...state.urls!, url])]
    await env.use('storage.write', { file: state.file, value: next })
    state.urls = next
    state.metadata.set(url, metadata)
  })
  state.writes = run.catch(() => {})
  await run
  emitService(env, 'auth-profile-added', url)
}
export async function removeAuthority(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const url = authorityUrl(input.args[0])
  const state = await authorities(env)
  const run = state.writes.then(async () => {
    const next = state.urls!.filter(value => value !== url)
    await env.use('storage.write', { file: state.file, value: next })
    state.urls = next
    state.metadata.delete(url)
  })
  state.writes = run.catch(() => {})
  await run
}
