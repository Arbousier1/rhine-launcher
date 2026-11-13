import { isAbsolute, join, resolve } from 'node:path'
import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import type { Instance, Settings } from '../types.ts'
import type { RhPaths } from '../contracts.ts'
import { resolveCurseforgeApiKey } from '../config/secrets.ts'
import { CURSEFORGE_API, CURSEFORGE_LOADER_IDS, MCIM_MIRROR, mirrorUrl } from '../market/curseforge.ts'
import { MODRINTH_API, MODRINTH_USER_AGENT } from '../market/modrinth.ts'
import { check, directory, fileName, hashes, httpUrl, inside, size } from '../modpack/safety.ts'
import { taskContext } from '../plugins/task-context.ts'
import { record, text, type OriginalCall } from './feature.ts'
import { validCurseforgeId, validModrinthId, type ResourceFolder } from './resource-state.ts'
import type { OriginalInstanceFile } from './manifests.ts'

/** Original MarketType is numeric: Modrinth=0, CurseForge=1. Never treat a version as a project ID. */
type Provider = 'modrinth' | 'curseforge'
type Json = Record<string, unknown>
interface Artifact { filename: string; downloads: string[]; hashes: Record<string, string>; size: number }
interface Dependency { projectId?: string; versionId?: string; type: 'required' | 'incompatible' }
interface Version { provider: Provider; id: string; projectId: string; gameVersions: string[]; loaders: string[]; published: number; files: Artifact[]; primary: number; dependencies: Dependency[] }
interface Project { id: string; folder: ResourceFolder }
const MAX_NODES = 256, MAX_REQUESTS = 1024, MAX_JSON_BYTES = 8 * 1024 * 1024
const folderTypes: Record<string, ResourceFolder> = { mod: 'mods', resourcepack: 'resourcepacks', shader: 'shaderpacks' }
function fail(message: string, code = 'INVALID_MARKET_MANIFEST', status = 400): never { throw new FeatureError(code, message, status) }
function mrId(value: unknown): string { if (!validModrinthId(value)) fail('Expected an actual eight-character Modrinth ID'); return value }
function cfId(value: unknown): number { if (!validCurseforgeId(value)) fail('Expected an actual positive CurseForge ID'); return value }
function array(value: unknown, label: string, max = MAX_NODES): unknown[] { if (!Array.isArray(value) || value.length > max) fail('Invalid ' + label + ' array'); return value }
function strings(value: unknown, label: string): string[] { return array(value, label, 4096).map(v => text(v, label)) }
function samePath(a: string, b: string): boolean { return process.platform === 'win32' ? resolve(a).toLowerCase() === resolve(b).toLowerCase() : resolve(a) === resolve(b) }
export async function marketInstance(env: FeatureEnvironment, value: unknown): Promise<Instance> {
  const path = text(value, 'absolute registered instance path')
  if (!isAbsolute(path) || /[\u0000-\u001f\u007f]/.test(path)) fail('A registered absolute native instance path is required', 'NATIVE_PATH_REQUIRED')
  const instances = await env.use<Promise<Instance[]>>('instance.list')
  const instance = instances.find(i => isAbsolute(i.path) && samePath(i.path, path))
  if (!instance) fail('Instance is not registered in this launcher', 'INSTANCE_NOT_FOUND', 404)
  inside(env.use<RhPaths>('paths.get').instances, instance.path)
  await directory(instance.path)
  return instance
}

/** Backend-only, bounded raw protocol adapter. The normalized clients cannot look up versionId/fileId
 * and discard secondary files / original dependency relation types. No credential is serialized. */
class ProviderReader {
  private requests = 0
  private versions = new Map<string, Promise<Version>>()
  private projects = new Map<string, Promise<Project>>()
  constructor(private env: FeatureEnvironment, readonly provider: Provider) {}
  private async request(path: string, body?: unknown): Promise<unknown> {
    check(this.env)
    if (++this.requests > MAX_REQUESTS) fail('Market resolution exceeds the request budget', 'MARKET_LIMIT')
    const settings = this.env.use<Settings>('settings.resolve')
    const base = httpUrl(this.provider === 'modrinth' ? settings.mirrors.modrinth || MODRINTH_API : settings.mirrors.curseforge || CURSEFORGE_API).replace(/\/+$/, '')
    const key = this.provider === 'curseforge' ? resolveCurseforgeApiKey(settings.curseforgeApiKey).value : undefined
    const official = this.provider === 'curseforge' && new URL(base).hostname === 'api.curseforge.com'
    const targets: { url: string; key?: string }[] = []
    if (this.provider === 'modrinth' || key || !official) targets.push({ url: base + path, key })
    if (official) targets.push({ url: mirrorUrl(base + path, MCIM_MIRROR) })
    let last: unknown
    for (const target of targets) {
      const signal = AbortSignal.any([taskContext(this.env).signal!, AbortSignal.timeout(15_000)])
      const headers: Record<string, string> = { accept: 'application/json', 'user-agent': MODRINTH_USER_AGENT }
      if (target.key) headers['x-api-key'] = target.key
      if (body !== undefined) headers['content-type'] = 'application/json'
      let response: Response
      try { response = await fetch(target.url, { method: body === undefined ? 'GET' : 'POST', headers, body: body === undefined ? undefined : JSON.stringify(body), signal, redirect: 'error' }) }
      catch { check(this.env); last = new FeatureError('MARKET_UNAVAILABLE', 'Cannot reach ' + this.provider + ' catalog', 502); continue }
      if (!response.ok) {
        await response.body?.cancel().catch(() => {})
        last = new FeatureError(response.status === 404 ? 'MARKET_VERSION_NOT_FOUND' : 'MARKET_UNAVAILABLE', this.provider + ' catalog returned HTTP ' + response.status, response.status === 404 ? 404 : 502)
        if (response.status !== 401 && response.status !== 403 && response.status < 500 && response.status !== 429) throw last
        continue
      }
      const declared = Number(response.headers.get('content-length'))
      if (declared > MAX_JSON_BYTES) { await response.body?.cancel().catch(() => {}); fail('Catalog JSON exceeds the response limit', 'MARKET_LIMIT') }
      const reader = response.body?.getReader()
      if (!reader) fail('Catalog returned no JSON')
      const chunks: Uint8Array[] = []; let bytes = 0
      try {
        while (true) { const item = await reader.read(); if (item.done) break; check(this.env); bytes += item.value.length; if (bytes > MAX_JSON_BYTES) fail('Catalog JSON exceeds the response limit', 'MARKET_LIMIT'); chunks.push(item.value) }
      } catch (error) { await reader.cancel().catch(() => {}); throw error }
      try { return JSON.parse(Buffer.concat(chunks, bytes).toString('utf8')) }
      catch { return fail('Catalog returned malformed JSON') }
    }
    throw last ?? new FeatureError('MARKET_UNAVAILABLE', 'No backend catalog route is configured', 502)
  }
  private parseVersion(value: unknown, requested?: string): Version {
    const raw = record(value, 'provider version')
    const id = this.provider === 'modrinth' ? mrId(raw.id) : String(cfId(raw.id))
    const projectId = this.provider === 'modrinth' ? mrId(raw.project_id) : String(cfId(raw.modId))
    if (requested !== undefined && id !== requested) fail('Catalog returned a different version/file ID')
    let files: Artifact[], primary = 0, dependencies: Dependency[]
    if (this.provider === 'modrinth') {
      const rawFiles = array(raw.files, 'Modrinth files', 128)
      if (!rawFiles.length) fail('Modrinth version has no files', 'MARKET_FILE_NOT_FOUND', 404)
      files = rawFiles.map(v => { const f = record(v); return { filename: fileName(f.filename), downloads: [httpUrl(f.url)], hashes: hashes(f.hashes), size: size(f.size, 'provider file') } })
      primary = Math.max(0, rawFiles.findIndex(v => record(v).primary === true))
      dependencies = array(raw.dependencies ?? [], 'Modrinth dependencies').flatMap(v => {
        const d = record(v), kind = d.dependency_type
        if (kind !== 'required' && kind !== 'incompatible') return [] // optional and embedded are NOT required.
        const project = d.project_id === null || d.project_id === undefined ? undefined : mrId(d.project_id)
        const version = d.version_id === null || d.version_id === undefined ? undefined : mrId(d.version_id)
        if (!project && !version) fail('Required/incompatible dependency has no provider identity', 'UNRESOLVED_DEPENDENCY')
        return [{ projectId: project, versionId: version, type: kind }]
      })
    } else {
      const digest: Record<string, string> = {}
      for (const v of array(raw.hashes, 'CurseForge hashes', 16)) { const h = record(v); if (h.algo === 1) digest.sha1 = text(h.value); else if (h.algo === 2) digest.md5 = text(h.value) }
      // Ask the provider for a real URL; do not synthesize a CDN download when it opted out.
      const downloads = typeof raw.downloadUrl === 'string' && raw.downloadUrl ? [httpUrl(raw.downloadUrl)] : []
      files = [{ filename: fileName(raw.fileName), downloads, hashes: hashes(digest), size: size(raw.fileLength, 'provider file') }]
      dependencies = array(raw.dependencies ?? [], 'CurseForge dependencies').flatMap(v => {
        const d = record(v)
        // Actual CurseForge enum: RequiredDependency=3, Incompatible=5 (not the normalized client's mapping).
        if (d.relationType !== 3 && d.relationType !== 5) return []
        return [{ projectId: String(cfId(d.modId)), type: d.relationType === 3 ? 'required' : 'incompatible' }]
      })
    }
    const gameVersions = strings(this.provider === 'modrinth' ? raw.game_versions : raw.gameVersions, 'provider game versions')
    const loaders = this.provider === 'modrinth' ? strings(raw.loaders, 'provider loaders').map(v => v.toLowerCase()) : gameVersions.map(v => v.toLowerCase()).filter(v => v in CURSEFORGE_LOADER_IDS)
    return { provider: this.provider, id, projectId, gameVersions, loaders, files, primary, dependencies, published: Date.parse(String(this.provider === 'modrinth' ? raw.date_published : raw.fileDate)) || 0 }
  }
  version(id: string): Promise<Version> {
    let value = this.versions.get(id)
    if (!value) {
      value = (async () => {
        if (this.provider === 'modrinth') return this.parseVersion(await this.request('/v2/version/' + encodeURIComponent(mrId(id))), id)
        const raw = record(await this.request('/v1/mods/files', { fileIds: [cfId(Number(id))] }))
        const items = array(raw.data, 'CurseForge file lookup', 1)
        if (items.length !== 1) fail('Requested CurseForge file was not returned', 'MARKET_VERSION_NOT_FOUND', 404)
        const parsed = this.parseVersion(items[0], id)
        if (!parsed.files[0].downloads.length) {
          const reply = record(await this.request('/v1/mods/' + parsed.projectId + '/files/' + parsed.id + '/download-url'))
          if (typeof reply.data === 'string' && reply.data) parsed.files[0].downloads = [httpUrl(reply.data)]
        }
        return parsed
      })()
      this.versions.set(id, value)
    }
    return value
  }
  project(id: string): Promise<Project> {
    let value = this.projects.get(id)
    if (!value) {
      value = (async () => {
        const payload = await this.request(this.provider === 'modrinth' ? '/v2/project/' + encodeURIComponent(mrId(id)) : '/v1/mods/' + cfId(Number(id)))
        const raw = this.provider === 'modrinth' ? record(payload) : record(record(payload).data)
        const actual = this.provider === 'modrinth' ? mrId(raw.id) : String(cfId(raw.id))
        if (actual !== id) fail('Catalog returned a different project ID')
        const type = this.provider === 'modrinth' ? raw.project_type : ({ 6: 'mod', 12: 'resourcepack', 6552: 'shader' } as Record<number, string>)[Number(raw.classId)]
        const folder = typeof type === 'string' ? folderTypes[type] : undefined
        if (!folder) fail('This original market file operation supports mods, resource packs and shader packs, not modpack/upstream imports', 'UNSUPPORTED_MARKET_PROJECT')
        return { id: actual, folder }
      })()
      this.projects.set(id, value)
    }
    return value
  }
  async latest(project: Project, instance: Instance): Promise<Version> {
    const loaders = instance.loaders.map(v => v.kind).filter(v => v !== 'vanilla')
    const query = new URLSearchParams()
    if (this.provider === 'modrinth') {
      query.set('game_versions', JSON.stringify([instance.gameVersion]))
      if (project.folder === 'mods' && loaders.length) query.set('loaders', JSON.stringify(loaders))
      const result = array(await this.request('/v2/project/' + project.id + '/version?' + query), 'Modrinth versions', 4096).map(v => this.parseVersion(v))
      return this.choose(result, project, instance)
    }
    const results: Version[] = [], filters = project.folder === 'mods' && loaders.length ? loaders : [undefined]
    for (const loader of filters) {
      for (let page = 0; page < 20; page++) {
        const q = new URLSearchParams({ gameVersion: instance.gameVersion, pageSize: '50', index: String(page * 50) })
        if (loader && CURSEFORGE_LOADER_IDS[loader]) q.set('modLoaderType', String(CURSEFORGE_LOADER_IDS[loader]))
        const payload = record(await this.request('/v1/mods/' + project.id + '/files?' + q)), items = array(payload.data, 'CurseForge versions', 50)
        results.push(...items.map(v => this.parseVersion(v)))
        const total = payload.pagination && typeof payload.pagination === 'object' ? Number((payload.pagination as Json).totalCount) : undefined
        if (items.length < 50 || (total !== undefined && (page + 1) * 50 >= total)) break
        if (page === 19) fail('CurseForge dependency pagination exceeds the bounded resolver', 'MARKET_LIMIT')
      }
    }
    const chosen = this.choose(results, project, instance)
    // Re-fetch the chosen actual file ID to resolve an omitted downloadUrl honestly.
    return this.version(chosen.id)
  }
  private choose(versions: Version[], project: Project, instance: Instance): Version {
    if (versions.some(v => v.projectId !== project.id)) fail('Dependency version list contains a foreign project ID')
    const candidate = versions.filter(v => compatible(v, project, instance)).sort((a, b) => b.published - a.published || b.id.localeCompare(a.id))[0]
    if (!candidate) fail('No required dependency version matches the registered instance game/loader', 'UNRESOLVED_DEPENDENCY', 409)
    return candidate
  }
}
function compatible(version: Version, project: Project, instance: Instance): boolean {
  if (!version.gameVersions.includes(instance.gameVersion)) return false
  if (project.folder !== 'mods') return true
  const loaders = instance.loaders.map(v => v.kind).filter(v => v !== 'vanilla')
  return loaders.some(v => version.loaders.includes(v)) || (!loaders.length && version.loaders.some(v => v === 'minecraft' || v === 'vanilla'))
}
function artifact(version: Version, filename?: string): Artifact {
  const selected = filename === undefined ? version.files[version.primary] : version.files.find(v => v.filename === filename)
  if (!selected) fail('The requested provider filename does not exist in this version', 'MARKET_FILE_NOT_FOUND', 404)
  if (!selected.downloads.length) fail('Provider does not supply a downloadable URL for this file', 'MARKET_DOWNLOAD_UNAVAILABLE', 409)
  return selected
}
function manifest(version: Version, project: Project, selected: Artifact): OriginalInstanceFile {
  return { path: project.folder + '/' + selected.filename, downloads: [...selected.downloads], hashes: { ...selected.hashes }, size: selected.size,
    ...(version.provider === 'modrinth' ? { modrinth: { projectId: version.projectId, versionId: version.id } } : { curseforge: { projectId: Number(version.projectId), fileId: Number(version.id) } }) }
}

/** Exact original resolveFromMarket; performs catalog IO only, never downloads or installs jars. */
export async function resolveFromMarket(input: OriginalCall, env: FeatureEnvironment, folder: ResourceFolder = 'mods'): Promise<OriginalInstanceFile[]> {
  const options = record(input.args[0], 'InstallMarketOptionWithInstance')
  if (options.market !== 0 && options.market !== 1) fail('Original market must be MarketType.Modrinth (0) or CurseForge (1)')
  const instance = await marketInstance(env, options.instancePath), provider: Provider = options.market === 0 ? 'modrinth' : 'curseforge'
  const raw = options.market === 0 ? options.version : options.file
  const selections = (Array.isArray(raw) ? array(raw, 'market selections') : [raw]).map(value => {
    const item = record(value, 'market version/file identifier')
    if (item.icon !== undefined) httpUrl(item.icon)
    return { id: provider === 'modrinth' ? mrId(item.versionId) : String(cfId(item.fileId)), filename: provider === 'modrinth' && item.filename !== undefined ? fileName(item.filename) : undefined }
  })
  const reader = new ProviderReader(env, provider), selected = new Map<string, { version: Version; project: Project }>(), queue: Version[] = [], files = new Map<string, OriginalInstanceFile>()
  const add = (version: Version, project: Project, filename?: string) => {
    if (!compatible(version, project, instance)) fail('Requested version/file does not match the instance game/loader', 'MARKET_INCOMPATIBLE', 409)
    const previous = selected.get(project.id)
    if (previous && previous.version.id !== version.id) fail('Conflicting requested/required versions of the same real project', 'MARKET_VERSION_CONFLICT', 409)
    const result = manifest(version, project, artifact(version, filename)), identity = result.path.normalize('NFC').toLowerCase(), current = files.get(identity)
    if (current && JSON.stringify(current) !== JSON.stringify(result)) fail('Resolved files collide at a portable relative path', 'FILE_EXISTS', 409)
    files.set(identity, result)
    if (!previous) { if (selected.size >= MAX_NODES) fail('Required dependency graph exceeds the node budget', 'MARKET_LIMIT'); selected.set(project.id, { version, project }); queue.push(version) }
  }
  // Pin every explicitly requested version before selecting project-only dependencies.
  for (const selection of selections) {
    check(env)
    const version = await reader.version(selection.id), project = await reader.project(version.projectId)
    if (project.folder !== folder) fail('The requested project belongs to a different original resource service', 'MARKET_RESOURCE_DOMAIN', 409)
    add(version, project, selection.filename)
  }
  for (let index = 0; index < queue.length; index++) {
    check(env); env.task?.setProgress({ stage: 'resolve', current: index, total: queue.length, value: queue.length ? index / queue.length : 1 })
    for (const dep of queue[index].dependencies.filter(v => v.type === 'required')) {
      let version: Version, project: Project
      if (dep.versionId) {
        version = await reader.version(dep.versionId)
        if (dep.projectId && dep.projectId !== version.projectId) fail('Required dependency version belongs to a different actual project')
        project = await reader.project(version.projectId)
      } else {
        project = await reader.project(dep.projectId!)
        version = selected.get(project.id)?.version ?? await reader.latest(project, instance)
      }
      const previous = selected.get(project.id)
      if (previous && previous.version.id !== version.id) fail('Conflicting required versions of a real provider project', 'MARKET_VERSION_CONFLICT', 409)
      if (!previous) add(version, project) // Existing explicit filename selection also satisfies cycles/pins.
    }
  }
  for (const version of queue) for (const dep of version.dependencies.filter(v => v.type === 'incompatible')) {
    if (dep.versionId ? queue.some(v => v.id === dep.versionId && (!dep.projectId || v.projectId === dep.projectId)) : selected.has(dep.projectId!)) fail('Selected real provider versions declare an incompatible dependency', 'MARKET_DEPENDENCY_CONFLICT', 409)
  }
  return [...files.values()]
}

/** Verify caller-supplied source refs against provider bytes before persisting them by actual SHA1.
 * This prevents a syntactically valid, but unrelated, provider ID becoming installed metadata. */
export async function verifyMarketReferences(env: FeatureEnvironment, file: OriginalInstanceFile, actual: { hashes: Record<string, string>; size: number }): Promise<void> {
  const verify = async (provider: Provider, id: string, projectId: string) => {
    const version = await new ProviderReader(env, provider).version(id)
    if (version.projectId !== projectId) fail('Manifest source reference belongs to another provider project', 'MARKET_SOURCE_MISMATCH', 409)
    const match = version.files.some(candidate => candidate.size === actual.size && Object.keys(candidate.hashes).length > 0 && Object.entries(candidate.hashes).every(([key, value]) => actual.hashes[key] === value))
    if (!match) fail('Manifest source reference does not identify the actual verified file bytes', 'MARKET_SOURCE_MISMATCH', 409)
  }
  if (file.modrinth) await verify('modrinth', mrId(file.modrinth.versionId), mrId(file.modrinth.projectId))
  if (file.curseforge) await verify('curseforge', String(cfId(file.curseforge.fileId)), String(cfId(file.curseforge.projectId)))
}

/** Separate original installFromMarket descriptor delegates the real resolved manifests to the
 * transactional installer. env.use carries the existing task/cancellation/renderer ownership. */
export async function installFromMarket(input: OriginalCall, env: FeatureEnvironment, folder: ResourceFolder = 'mods'): Promise<string[]> {
  const options = record(input.args[0]), files = await env.use<Promise<{ result: OriginalInstanceFile[] }>>('ellan.market.' + folder + '.resolve', input)
  await env.use('ellan.manifest.install', { ...input, args: [{ path: options.instancePath, oldFiles: [], files: files.result }] })
  return files.result.map(file => join(resolve(text(options.instancePath)), ...file.path.split('/')))
}
