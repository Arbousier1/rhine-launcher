import { basename, extname, join } from 'node:path'
import { lstat, readdir } from 'node:fs/promises'
import { crc32 } from 'node:zlib'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RhPaths } from '../contracts.ts'
import type { Instance } from '../types.ts'
import { check, directory, fingerprint, inside, targetPath } from '../modpack/safety.ts'
import { MAX_ICON_BYTES, mimeOf } from '../mods/descriptor.ts'
import { parseToml, tomlString, type TomlTable } from '../mods/toml.ts'
import { readZipEntries, readZipEntry, ZipArchive, ZipError } from '../mods/zip.ts'

/** Wire shapes used by the original Resource / ResourceState, not Rhine ModMeta. */
type ObjectData = Record<string, unknown>
export interface FabricMetadata extends ObjectData { id: string; version: string; name?: string }
export interface QuiltMetadata extends ObjectData { quilt_loader: ObjectData & { id: string; version: string } }
export interface ForgeTomlMetadata extends ObjectData {
  modid: string; version: string; displayName: string; description: string; authors: string
  logoFile: string; modLoader: string; loaderVersion: string; dependencies: ObjectData[]
}
export interface ForgeMetadata extends ObjectData {
  modid: string; name: string; version: string; description: string; authors: string[]
  logoFile: string; acceptMinecraft: string; acceptForge: string
  modsToml: ForgeTomlMetadata[]; mcmodInfo: ObjectData[]; modAnnotations: ObjectData[]
  manifest: Record<string, string>
}
export interface ResourceMetadata extends ObjectData {
  fabric?: FabricMetadata | FabricMetadata[]
  quilt?: QuiltMetadata
  forge?: ForgeMetadata
  neoforge?: ForgeTomlMetadata & { children: ForgeTomlMetadata[] }
  liteloader?: ObjectData
  resourcepack?: ObjectData
  shaderpack?: ObjectData
  modrinth?: { projectId: string; versionId: string }
  curseforge?: { projectId: number; fileId: number }
}
export interface ResourceFile {
  version: 3; path: string; fileName: string; name: string; hash: string
  size: number; mtime: number; atime: number; ctime: number; ino: number
  isDirectory: boolean; metadata: ResourceMetadata; icons: string[]
}
export interface ResourceError { path: string; code: string }
export interface ResourceState { files: ResourceFile[]; errors: ResourceError[] }
export type ResourceFolder = 'mods' | 'resourcepacks' | 'shaderpacks'
export interface UpdateResourcePayload { hash: string; icons?: string[]; metadata?: ResourceMetadata; uris?: string[] }
export type ResourceActionTuple = [ResourceFile, 0] | [string, 1] | [UpdateResourcePayload[], 2]
export type ResourceErrorActionTuple = [ResourceError, 0] | [string, 1]
export interface ResourceMetadataCacheEntry {
  metadata?: Pick<ResourceMetadata, 'modrinth' | 'curseforge'>
  name?: string; icons?: string[]
}
export type ResourceMetadataCache = Record<string, ResourceMetadataCacheEntry>

const MAX_METADATA_BYTES = 4 * 1024 * 1024
const object = (value: unknown): ObjectData | undefined => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as ObjectData : undefined
const string = (value: unknown): string => typeof value === 'string' ? value : ''
function invalid(message: string): never { const error = new Error(message); error.name = 'InvalidModMetadata'; throw error }
export function validModrinthId(id: unknown): id is string { return typeof id === 'string' && /^[0-9A-Za-z]{8}$/.test(id) }
export function validCurseforgeId(id: unknown): id is number { return Number.isSafeInteger(id) && (id as number) > 0 }
export function sourceMetadata(value: unknown): Pick<ResourceMetadata, 'modrinth' | 'curseforge'> {
  const input = object(value), result: Pick<ResourceMetadata, 'modrinth' | 'curseforge'> = {}
  const mr = object(input?.modrinth), cf = object(input?.curseforge)
  if (validModrinthId(mr?.projectId) && validModrinthId(mr?.versionId)) result.modrinth = { projectId: mr.projectId, versionId: mr.versionId }
  if (validCurseforgeId(cf?.projectId) && validCurseforgeId(cf?.fileId)) result.curseforge = { projectId: cf.projectId, fileId: cf.fileId }
  return result
}
export function resourceMetadataFile(env: FeatureEnvironment): string {
  return join(env.use<RhPaths>('paths.get').root, '.rhine', 'ellan-resource-metadata.json')
}
/** Only explicit, valid persisted source references may supplement archive metadata. */
export async function readResourceMetadataCache(env: FeatureEnvironment): Promise<ResourceMetadataCache> {
  const raw = object(await env.use<Promise<unknown>>('storage.read', { file: resourceMetadataFile(env), fallback: {} })) ?? {}
  const entries: [string, ResourceMetadataCacheEntry][] = []
  for (const [hash, value] of Object.entries(raw)) {
    if (!/^[a-f0-9]{40}$/i.test(hash)) continue
    const entry = object(value)
    if (!entry) continue
    entries.push([hash.toLowerCase(), {
      metadata: sourceMetadata(entry.metadata),
      ...(typeof entry.name === 'string' ? { name: entry.name } : {}),
      ...(Array.isArray(entry.icons) ? { icons: entry.icons.filter((i): i is string => typeof i === 'string' && /^(https?:\/\/|data:image\/(png|jpeg|webp|gif);base64,)/.test(i)) } : {}),
    }])
  }
  return Object.fromEntries(entries)
}

async function archiveBytes(archive: ZipArchive, name: string, max = MAX_METADATA_BYTES): Promise<Uint8Array | undefined> {
  const entry = archive.entry(name)
  if (!entry || entry.isDirectory) return undefined
  if (entry.uncompressedSize > max || entry.compressedSize > max) invalid('Archive entry exceeds the limit: ' + name)
  const data = await archive.read(name)
  if (!data || data.length !== entry.uncompressedSize || data.length > max || (crc32(data) >>> 0) !== entry.crc32) throw new ZipError('Invalid ZIP entry size or checksum: ' + name, archive.file)
  return data
}
async function archiveText(archive: ZipArchive, name: string): Promise<string | undefined> {
  const data = await archiveBytes(archive, name)
  return data ? new TextDecoder('utf-8', { fatal: true }).decode(data) : undefined
}
async function archiveJson(archive: ZipArchive, name: string): Promise<unknown> {
  const text = await archiveText(archive, name)
  if (text === undefined) return undefined
  try { return JSON.parse(text) } catch { return invalid('Invalid JSON descriptor: ' + name) }
}
function fabricMetadata(value: unknown): FabricMetadata {
  const mod = object(value)
  if (!mod || !string(mod.id) || !string(mod.version)) invalid('Fabric descriptor requires its actual id and version')
  return mod as FabricMetadata
}
/** Match the original Fabric parser's one-level jars[] metadata expansion. */
async function nestedFabricMetadata(archive: ZipArchive, root: FabricMetadata): Promise<FabricMetadata | FabricMetadata[]> {
  if (!Array.isArray(root.jars)) return root
  if (root.jars.length > 64) invalid('Too many declared nested Fabric jars')
  const result: FabricMetadata[] = [root]
  for (const jar of root.jars) {
    const file = string(object(jar)?.file)
    if (!file) continue
    try {
      const bytes = await archiveBytes(archive, file, 16 * 1024 * 1024)
      if (!bytes) continue
      const entry = readZipEntries(bytes).find(entry => entry.name.toLowerCase() === 'fabric.mod.json' && !entry.isDirectory)
      if (!entry || entry.compressedSize > MAX_METADATA_BYTES || entry.uncompressedSize > MAX_METADATA_BYTES) continue
      const descriptor = await readZipEntry(bytes, entry)
      if (descriptor.length !== entry.uncompressedSize || descriptor.length > MAX_METADATA_BYTES || (crc32(descriptor) >>> 0) !== entry.crc32) continue
      result.push(fabricMetadata(JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(descriptor))))
    } catch { /* A nested jar without valid Fabric metadata is not a fabricated mod. */ }
  }
  return result
}
function manifestMetadata(text: string | undefined): Record<string, string> {
  const result: Record<string, string> = {}
  let key = ''
  for (const line of (text ?? '').replace(/\r\n?/g, '\n').split('\n')) {
    if (!line) break // Main section only; named JAR entries are not mod metadata.
    if (line.startsWith(' ') && key) result[key] += line.slice(1)
    else {
      const colon = line.indexOf(':')
      if (colon > 0) { key = line.slice(0, colon); result[key] = line.slice(colon + 1).trimStart() }
    }
  }
  return result
}
function tomlMods(text: string, manifest: Record<string, string>): ForgeTomlMetadata[] {
  const table = parseToml(text)
  const rawMods = Array.isArray(table.mods) ? table.mods : []
  const result: ForgeTomlMetadata[] = []
  for (const raw of rawMods) {
    const mod = object(raw) as TomlTable | undefined
    const modid = string(mod?.modId) || string(mod?.modid)
    if (!mod || !modid) invalid('TOML descriptor requires its actual modId')
    const allDependencies = object(table.dependencies)
    const dependencies = Array.isArray(table.dependencies) ? table.dependencies : allDependencies?.[modid]
    const normalizedDependencies = (Array.isArray(dependencies) ? dependencies : []).map(value => {
      const dep = object(value)
      if (!dep || !string(dep.modId)) invalid('Invalid TOML dependency')
      return { ...dep, modId: dep.modId, mandatory: typeof dep.mandatory === 'boolean' ? dep.mandatory : dep.type !== 'optional', versionRange: string(dep.versionRange) }
    })
    let version = tomlString(mod.version) ?? ''
    const jarVersion = '$' + '{file.jarVersion}'
    if (version.includes(jarVersion) && manifest['Implementation-Version']) version = version.replaceAll(jarVersion, manifest['Implementation-Version'])
    result.push({ ...mod, modid, version, displayName: string(mod.displayName) || modid,
      description: string(mod.description), authors: tomlString(mod.authors) ?? '', logoFile: string(mod.logoFile),
      modLoader: string(table.modLoader), loaderVersion: string(table.loaderVersion),
      license: table.license, issueTrackerURL: table.issueTrackerURL, dependencies: normalizedDependencies,
    })
  }
  if (!result.length) invalid('TOML descriptor contains no actual mod entries')
  return result
}
function forgeMetadata(modsToml: ForgeTomlMetadata[], mcmodInfo: ObjectData[], manifest: Record<string, string>): ForgeMetadata {
  const first = modsToml[0], legacy = mcmodInfo[0]
  const modid = first?.modid || string(legacy?.modid)
  if (!modid) invalid('Forge descriptor requires its actual modid')
  const legacyAuthors = Array.isArray(legacy?.authorList) ? legacy.authorList.filter((value): value is string => typeof value === 'string') : []
  return { modsToml, mcmodInfo, modAnnotations: [], manifest, modid,
    name: first?.displayName || string(legacy?.name) || modid,
    version: first?.version || string(legacy?.version), description: first?.description || string(legacy?.description),
    authors: first ? first.authors ? [first.authors] : [] : legacyAuthors,
    logoFile: first?.logoFile || string(legacy?.logoFile),
    acceptMinecraft: first ? string(first.dependencies.find(d => d.modId === 'minecraft')?.versionRange) : string(legacy?.mcversion) ? '[' + string(legacy?.mcversion) + ']' : '',
    acceptForge: first ? string(first.dependencies.find(d => d.modId === 'forge')?.versionRange) || '[*]' : '[*]',
  }
}
function iconPaths(value: unknown): string[] {
  if (typeof value === 'string') return [value]
  const icons = object(value)
  return icons ? Object.entries(icons).sort(([a], [b]) => Number(a) - Number(b)).map(([, path]) => path).filter((path): path is string => typeof path === 'string') : []
}
async function optionalMetadata<T>(parse: () => Promise<T>): Promise<T | undefined> {
  try { return await parse() } catch (error) {
    // The original parser probes each loader independently. A malformed or
    // unsupported descriptor must not hide another real descriptor in a hybrid.
    if (error instanceof ZipError || ['ENOENT', 'EACCES', 'EPERM', 'EIO', 'ELOOP'].includes((error as NodeJS.ErrnoException).code ?? '')) throw error
    return undefined
  }
}
async function readArchiveMetadata(archive: ZipArchive, folder: ResourceFolder): Promise<{ metadata: ResourceMetadata; icons: string[] }> {
  const metadata: ResourceMetadata = {}, candidates: string[] = []
  if (folder === 'mods') {
    const fabric = await optionalMetadata(async () => {
      const raw = await archiveJson(archive, 'fabric.mod.json')
      if (raw === undefined) return undefined
      const mods = Array.isArray(raw) ? raw.map(fabricMetadata) : await nestedFabricMetadata(archive, fabricMetadata(raw))
      if (Array.isArray(mods) && !mods.length) invalid('Empty Fabric metadata array')
      return mods
    })
    if (fabric) {
      metadata.fabric = fabric
      candidates.push(...iconPaths((Array.isArray(fabric) ? fabric[0] : fabric).icon))
    }
    const quilt = await optionalMetadata(async () => {
      const raw = await archiveJson(archive, 'quilt.mod.json')
      if (raw === undefined) return undefined
      const root = object(raw), loader = object(root?.quilt_loader)
      if (!root || !loader || !string(loader.id) || !string(loader.version)) invalid('Quilt descriptor requires quilt_loader.id and version')
      return root as QuiltMetadata
    })
    if (quilt) { metadata.quilt = quilt; candidates.push(...iconPaths(object(quilt.quilt_loader.metadata)?.icon)) }
    const manifest = await optionalMetadata(async () => manifestMetadata(await archiveText(archive, 'META-INF/MANIFEST.MF'))) ?? {}
    const neo = await optionalMetadata(async () => {
      const text = await archiveText(archive, 'META-INF/neoforge.mods.toml')
      return text === undefined ? [] : tomlMods(text, manifest)
    })
    if (neo?.length) { metadata.neoforge = { ...neo[0], children: neo.slice(1) }; candidates.push(neo[0].logoFile) }
    const forge = await optionalMetadata(async () => {
      const text = await archiveText(archive, 'META-INF/mods.toml')
      return text === undefined ? [] : tomlMods(text, manifest)
    })
    const legacy = await optionalMetadata(async () => {
      const raw = await archiveJson(archive, 'mcmod.info')
      if (raw === undefined) return []
      const mods = Array.isArray(raw) ? raw : object(raw)?.modList
      if (!Array.isArray(mods)) invalid('Invalid mcmod.info')
      return mods.map(value => object(value) ?? invalid('Invalid mcmod.info entry'))
    })
    if (forge?.length || legacy?.length) {
      const actual = await optionalMetadata(async () => forgeMetadata(forge ?? [], legacy ?? [], manifest))
      if (actual) { metadata.forge = actual; candidates.push(actual.logoFile) }
    }
    const lite = await optionalMetadata(async () => {
      const raw = await archiveJson(archive, 'litemod.json')
      if (raw === undefined) return undefined
      const mod = object(raw)
      if (!mod || !string(mod.name)) invalid('Liteloader descriptor requires its actual name')
      return mod
    })
    if (lite) metadata.liteloader = lite
  } else if (folder === 'resourcepacks') {
    const pack = object(await optionalMetadata(async () => archiveJson(archive, 'pack.mcmeta')))
    if (object(pack?.pack)) metadata.resourcepack = object(pack?.pack)
    if (metadata.resourcepack) candidates.push('pack.png')
  } else if (archive.entries.some(entry => entry.name.startsWith('shaders/'))) metadata.shaderpack = {}
  const icons: string[] = []
  for (const candidate of [...new Set(candidates.filter(Boolean))]) {
    const mime = mimeOf(candidate)
    // Do not serve active SVG payloads from an arbitrary mod jar.
    if (!mime || mime === 'image/svg+xml') continue
    const entry = archive.entry(candidate)
    if (!entry || entry.uncompressedSize > MAX_ICON_BYTES || entry.compressedSize > MAX_ICON_BYTES) continue
    const bytes = await archiveBytes(archive, candidate, MAX_ICON_BYTES)
    if (bytes) icons.push('data:' + mime + ';base64,' + Buffer.from(bytes).toString('base64'))
  }
  return { metadata, icons }
}
/** Read all loader descriptors, including hybrid jars, without inventing loader/provider IDs. */
export async function readResourceFile(path: string, folder: ResourceFolder = 'mods', cache: ResourceMetadataCache = {}, env?: FeatureEnvironment): Promise<ResourceFile> {
  check(env)
  const before = await fingerprint(path, env, ['sha1'])
  const archive = await ZipArchive.open(path)
  let parsed: Awaited<ReturnType<typeof readArchiveMetadata>>
  try { parsed = await readArchiveMetadata(archive, folder) } finally { await archive.close() }
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink() || info.size !== before.size || info.mtimeMs !== before.mtimeMs || info.ctimeMs !== before.ctimeMs || info.ino !== before.ino || info.dev !== before.dev) {
    const error = new Error('Resource changed while reading its metadata'); error.name = 'FILE_CHANGED'; throw error
  }
  const hash = before.hashes.sha1!, saved = cache[hash]
  const metadata = { ...parsed.metadata, ...sourceMetadata(saved?.metadata) }
  const name = saved?.name ?? basename(path)
  return { version: 3, path, fileName: basename(path), name, hash, size: info.size, mtime: info.mtimeMs,
    ctime: info.ctimeMs, atime: info.atimeMs, ino: info.ino, isDirectory: false, metadata,
    icons: [...parsed.icons, ...(saved?.icons ?? [])],
  }
}
/** No watcher or lease is created here: the Lead owns state lifetimes and IO watchers. */
export async function scanResourceDirectory(env: FeatureEnvironment, instance: Pick<Instance, 'id' | 'path'>, folder: ResourceFolder = 'mods'): Promise<ResourceState> {
  const paths = env.use<RhPaths>('paths.get')
  inside(paths.instances, instance.path)
  await directory(instance.path)
  const root = join(instance.path, folder), result: ResourceState = { files: [], errors: [] }
  let entries: string[]
  try { await directory(root); entries = await readdir(root) } catch (error) {
    // A missing mods folder is a real empty state; permission/junction failures are not.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return result
    // directory() deliberately rejects a nonexistent child before readdir can report ENOENT.
    try { await lstat(root) } catch (missing) { if ((missing as NodeJS.ErrnoException).code === 'ENOENT') return result }
    throw error
  }
  const cache = await readResourceMetadataCache(env)
  for (const name of entries.sort()) {
    check(env)
    const plain = name.endsWith('.disabled') ? name.slice(0, -'.disabled'.length) : name
    if (!(folder === 'mods' ? ['.jar', '.litemod', '.zip'] : ['.zip']).includes(extname(plain).toLowerCase())) continue
    const path = join(root, name)
    try {
      const target = await targetPath(root, name)
      result.files.push(await readResourceFile(target, folder, cache, env))
    } catch (error) {
      check(env)
      const problem = error as NodeJS.ErrnoException
      if (problem.code === 'ENOENT') continue // A normal removal race, not a broken resource.
      result.errors.push({ path, code: error instanceof ZipError ? 'InvalidZipFileError' : problem.code ?? problem.name ?? 'ParseResourceError' })
    }
  }
  return result
}
