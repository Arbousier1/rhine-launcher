/** Independent Yggdrasil protocol helpers and verified agent artifact IO, not a plugin/service. */
import { randomBytes, createHash } from 'node:crypto'
import { mkdir, readFile, writeFile, rename, unlink } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import type { DownloadApi, TaskHandle } from '../contracts.ts'
import { expandUuid, compactUuid } from './uuid.ts'
import { AccountError, throwIfAborted } from './errors.ts'
import { JSON_HEADERS, requestJson } from './http.ts'

export const AUTHLIB_INJECTOR_MANIFEST_URL = 'https://authlib-injector.yushi.moe/artifact/latest.json'
export const AUTHLIB_INJECTOR_PRIMARY_URL = AUTHLIB_INJECTOR_MANIFEST_URL
export const AUTHLIB_INJECTOR_MIRROR_URL = 'https://bmclapi2.bangbang93.com/mirrors/authlib-injector'

export interface YggdrasilProfile { id: string; name: string }
export interface YggdrasilAuthResponse {
  accessToken?: string
  clientToken?: string
  selectedProfile?: YggdrasilProfile
  availableProfiles?: YggdrasilProfile[]
  error?: string
  errorMessage?: string
}
export interface YggdrasilOptions { signal?: AbortSignal; profileId?: string }

/** Canonical server identity. Never send a password/token via HTTP except exact loopback hosts. */
export function validateAuthServerUrl(value: string): string {
  if (typeof value !== 'string' || !value.trim() || /[\u0000-\u0020\u007f]/.test(value.trim())) throw new AccountError('请输入有效的外置认证服务器 URL', 'INVALID_AUTH_SERVER')
  let url: URL
  try { url = new URL(value.trim()) } catch { throw new AccountError('外置认证服务器必须为绝对 HTTPS URL', 'INVALID_AUTH_SERVER') }
  const loopback = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash) {
    throw new AccountError('外置认证服务器必须使用 HTTPS（localhost 回环地址可用 HTTP），且不能含密码、查询或片段', 'INVALID_AUTH_SERVER')
  }
  let decoded: string
  try { decoded = decodeURIComponent(url.pathname) } catch { throw new AccountError('外置认证路径编码无效', 'INVALID_AUTH_SERVER') }
  if (/[\u0000-\u001f\u007f]/.test(decoded)) throw new AccountError('外置认证路径含控制字符', 'INVALID_AUTH_SERVER')
  return url.href.replace(/\/+$/, '')
}
export function yggdrasilAccountId(base: string, profileId: string): string {
  const uuid = expandUuid(profileId)
  if (!uuid) throw new AccountError('外置角色 UUID 无效', 'PROFILE_INVALID')
  return 'authlib-' + createHash('sha256').update(validateAuthServerUrl(base)).digest('hex').slice(0, 24) + '-' + compactUuid(uuid)
}
function parseProfile(value: unknown): YggdrasilProfile | undefined {
  if (!value || typeof value !== 'object') return undefined
  const profile = value as Partial<YggdrasilProfile>
  if (typeof profile.id !== 'string' || !expandUuid(profile.id) || typeof profile.name !== 'string' || !profile.name.trim() || profile.name.length > 64 || /[\u0000-\u001f\u007f]/.test(profile.name)) return undefined
  return { id: compactUuid(profile.id), name: profile.name.trim() }
}
function yggdrasilFailure(status: number, body?: YggdrasilAuthResponse): never {
  // Do not include errorMessage: a hostile/buggy provider could echo credentials.
  const code = body?.error === 'ForbiddenOperationException' || status === 403 ? 'INVALID_CREDENTIALS' : 'YGGDRASIL_AUTH_FAILED'
  throw new AccountError(code === 'INVALID_CREDENTIALS' ? '外置登录凭据或令牌无效，请重新登录' : '外置认证请求失败（HTTP ' + status + '）', code, { status: status >= 500 ? 502 : 400 })
}
function responseTokens(body: YggdrasilAuthResponse | undefined, requestedClientToken?: string): { accessToken: string; clientToken?: string } {
  const accessToken = typeof body?.accessToken === 'string' ? body.accessToken.trim() : ''
  if (!accessToken) throw new AccountError('外置认证未返回有效访问令牌', 'INVALID_TOKEN_RESPONSE')
  const clientToken = typeof body?.clientToken === 'string' ? body.clientToken : requestedClientToken
  if (requestedClientToken && clientToken !== requestedClientToken) throw new AccountError('外置认证返回了不同的 client_token，已拒绝保存', 'CLIENT_TOKEN_MISMATCH')
  return { accessToken, clientToken }
}

export async function authenticateYggdrasil(authServerUrl: string, username: string, password: string, options: YggdrasilOptions = {}): Promise<{ accessToken: string; clientToken: string; profile: YggdrasilProfile }> {
  const base = validateAuthServerUrl(authServerUrl)
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string' || !password) throw new AccountError('请输入用户名和密码', 'INVALID_CREDENTIALS')
  const clientToken = randomBytes(32).toString('base64url')
  const response = await requestJson<YggdrasilAuthResponse>(base + '/authserver/authenticate', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ agent: { name: 'Minecraft', version: 1 }, username: username.trim(), password, clientToken, requestUser: true }),
  }, '外置账号登录', options.signal)
  if (response.status < 200 || response.status >= 300 || response.body?.error) yggdrasilFailure(response.status, response.body)
  const tokens = responseTokens(response.body, clientToken)
  const selected = parseProfile(response.body?.selectedProfile)
  const available = Array.isArray(response.body?.availableProfiles) ? response.body.availableProfiles.map(parseProfile).filter((profile): profile is YggdrasilProfile => !!profile) : []
  let requested: YggdrasilProfile | undefined
  if (options.profileId) {
    const id = expandUuid(options.profileId)
    if (!id) throw new AccountError('选择的角色 UUID 无效', 'PROFILE_INVALID')
    requested = [selected, ...available].find(profile => profile && expandUuid(profile.id) === id)
    if (!requested) throw new AccountError('选择的角色不属于该外置账号', 'PROFILE_NOT_FOUND')
  } else requested = selected ?? (available.length === 1 ? available[0] : undefined)
  if (!requested) {
    throw new AccountError(available.length > 1 ? '该账号有多个角色，请选择 profileId 后再登录；不会随意选择第一个角色' : '该外置账号没有可用的游戏角色（Profile）', available.length > 1 ? 'PROFILE_SELECTION_REQUIRED' : 'PROFILE_NOT_FOUND')
  }
  if (!selected || selected.id !== requested.id) {
    // availableProfiles are not automatically bound to the token. Select it with the protocol's refresh exchange.
    const bound = await refreshYggdrasil(base, tokens.accessToken, clientToken, { signal: options.signal, selectedProfile: requested })
    if (!bound.profile || bound.profile.id !== requested.id) throw new AccountError('外置认证未绑定所选角色', 'PROFILE_SELECTION_FAILED')
    return { accessToken: bound.accessToken, clientToken, profile: bound.profile }
  }
  return { accessToken: tokens.accessToken, clientToken, profile: selected }
}

export async function refreshYggdrasil(authServerUrl: string, accessToken: string, clientToken?: string, options: { signal?: AbortSignal; selectedProfile?: YggdrasilProfile } = {}): Promise<{ accessToken: string; clientToken?: string; profile?: YggdrasilProfile }> {
  const base = validateAuthServerUrl(authServerUrl)
  if (typeof accessToken !== 'string' || !accessToken) throw new AccountError('外置账号缺少访问令牌，请重新登录', 'MISSING_CREDENTIALS')
  const response = await requestJson<YggdrasilAuthResponse>(base + '/authserver/refresh', {
    method: 'POST', headers: JSON_HEADERS,
    body: JSON.stringify({ accessToken, clientToken, selectedProfile: options.selectedProfile, requestUser: true }),
  }, '外置账号令牌刷新', options.signal)
  if (response.status < 200 || response.status >= 300 || response.body?.error) yggdrasilFailure(response.status, response.body)
  const tokens = responseTokens(response.body, clientToken)
  const profile = parseProfile(response.body?.selectedProfile)
  if (response.body?.selectedProfile && !profile) throw new AccountError('外置认证返回了无效的角色', 'PROFILE_INVALID')
  return { ...tokens, profile }
}

/** Invalid-token responses are false; transport/server failures remain errors, never fake a valid login. */
export async function validateYggdrasil(authServerUrl: string, accessToken: string, clientToken?: string, signal?: AbortSignal): Promise<boolean> {
  const base = validateAuthServerUrl(authServerUrl)
  if (!accessToken) return false
  const response = await requestJson<YggdrasilAuthResponse>(base + '/authserver/validate', {
    method: 'POST', headers: JSON_HEADERS, body: JSON.stringify({ accessToken, clientToken }),
  }, '外置账号令牌验证', signal)
  if (response.status >= 200 && response.status < 300 && !response.body?.error) return true
  if (response.status === 401 || response.status === 403) return false
  yggdrasilFailure(response.status, response.body)
}

export interface AuthlibInjectorManifest { buildNumber: number; version: string; downloadUrl: string; sha256: string }
export function parseAuthlibInjectorManifest(text: string): AuthlibInjectorManifest {
  let raw: unknown
  try { raw = JSON.parse(text) } catch { throw new AccountError('authlib-injector 官方清单不是有效 JSON', 'AGENT_MANIFEST_INVALID') }
  if (!raw || typeof raw !== 'object') throw new AccountError('authlib-injector 官方清单无效', 'AGENT_MANIFEST_INVALID')
  const manifest = raw as { build_number?: number; version?: string; download_url?: string; checksums?: { sha256?: string } }
  const buildNumber = manifest.build_number
  const version = manifest.version
  const sha256 = manifest.checksums?.sha256
  if (!Number.isSafeInteger(buildNumber) || (buildNumber ?? 0) <= 0 || typeof version !== 'string' || !/^[0-9A-Za-z][0-9A-Za-z.+_-]{0,63}$/.test(version) || typeof sha256 !== 'string' || !/^[0-9a-f]{64}$/i.test(sha256)) throw new AccountError('authlib-injector 清单缺少有效版本或 SHA256', 'AGENT_MANIFEST_INVALID')
  const expectedUrl = 'https://authlib-injector.yushi.moe/artifact/' + buildNumber + '/authlib-injector-' + version + '.jar'
  if (manifest.download_url !== expectedUrl) throw new AccountError('authlib-injector 下载地址不是对应版本的官方 HTTPS 工件', 'AGENT_MANIFEST_INVALID')
  return { buildNumber: buildNumber!, version, downloadUrl: expectedUrl, sha256: sha256.toLowerCase() }
}
export function validateAgentMirror(value: string): string {
  let url: URL
  try { url = new URL(value) } catch { throw new AccountError('authlib-injector 镜像地址无效', 'INVALID_AGENT_MIRROR') }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || /[\u0000-\u0020\u007f]/.test(value)) throw new AccountError('authlib-injector 镜像必须为无凭据、查询和片段的 HTTPS 基址', 'INVALID_AGENT_MIRROR')
  return url.href.replace(/\/+$/, '')
}
export async function verifyAgentSha256(path: string, sha256: string): Promise<boolean> {
  try { return createHash('sha256').update(await readFile(path)).digest('hex') === sha256.toLowerCase() } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw error
  }
}

/** Read official latest.json on every prepare. Reuse a versioned jar only after SHA256 verification. */
export async function ensureAuthlibInjector(librariesDir: string, download: Pick<DownloadApi, 'text' | 'buffer'>, options: { mirror?: string; signal?: AbortSignal; task?: TaskHandle } = {}): Promise<string> {
  const check = () => { throwIfAborted(options.signal); options.task?.throwIfCancelled() }
  check()
  const mirror = validateAgentMirror(options.mirror || AUTHLIB_INJECTOR_MIRROR_URL)
  options.task?.setProgress({ stage: 'resolve', value: 0, message: '读取 authlib-injector 官方版本清单' })
  const manifest = parseAuthlibInjectorManifest(await download.text(AUTHLIB_INJECTOR_MANIFEST_URL))
  check()
  const destination = join(librariesDir, 'authlib-injector', 'authlib-injector-' + manifest.version + '-b' + manifest.buildNumber + '.jar')
  if (await verifyAgentSha256(destination, manifest.sha256)) { check(); return destination }
  const mirrorUrl = mirror + '/artifact/' + manifest.buildNumber + '/authlib-injector-' + manifest.version + '.jar'
  let verified: Uint8Array | undefined
  let lastError: unknown
  for (const url of [...new Set([manifest.downloadUrl, mirrorUrl])]) {
    check()
    try {
      options.task?.setProgress({ stage: 'download', value: 0.2, message: '下载 authlib-injector ' + manifest.version })
      const bytes = await download.buffer(url)
      check()
      options.task?.setProgress({ stage: 'verify', value: 0.8, message: '校验 authlib-injector SHA256' })
      if (createHash('sha256').update(bytes).digest('hex') !== manifest.sha256) throw new AccountError('authlib-injector SHA256 校验失败，未安装该工件', 'AGENT_HASH_MISMATCH')
      verified = bytes
      break
    } catch (error) { check(); lastError = error }
  }
  if (!verified) {
    if (lastError instanceof AccountError) throw lastError
    throw new AccountError('authlib-injector 官方及镜像工件下载失败', 'AGENT_DOWNLOAD_FAILED', { status: 502 })
  }
  check()
  await mkdir(dirname(destination), { recursive: true })
  const temp = destination + '.' + randomBytes(12).toString('hex') + '.part'
  try {
    await writeFile(temp, verified, { flag: 'wx' })
    check()
    await rename(temp, destination)
  } finally {
    await unlink(temp).catch((error: NodeJS.ErrnoException) => { if (error.code !== 'ENOENT') throw error })
  }
  options.task?.setProgress({ stage: 'done', value: 1, message: 'authlib-injector 已校验就绪' })
  return destination
}
