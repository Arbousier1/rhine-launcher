/** Validated modpack planning and staged transaction implementation; no service registration. */
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { cp, mkdtemp, readdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { RhPaths } from '../contracts.ts'
import type { Instance, InstanceConfig, LoaderSpec, Settings } from '../types.ts'
import { PackArchive, MAX_ARCHIVE_BYTES, MAX_ENTRIES, MAX_TOTAL_BYTES } from './archive.ts'
import { apiBase, curseFile, downloadVerified, jsonRequest, type DownloadFile } from './network.ts'
import { check, directory, fail, hashes, inside, object, packPath, relativePath, size, stagedSource, targetPath, text, version } from './safety.ts'
import { resolveCurseforgeApiKey } from '../config/secrets.ts'

export interface ModrinthIndex {
  formatVersion: number; game: string; versionId: string; name: string; summary?: string
  files: { path: string; hashes: { sha1?: string; sha512?: string }; env?: { client?: string; server?: string }; downloads: string[]; fileSize: number }[]
  dependencies: Record<string, string>
}
export interface CurseForgeManifest {
  minecraft: { version: string; modLoaders: { id: string; primary: boolean }[] }
  manifestType: string; manifestVersion: number; name: string; version: string; author: string
  files: { projectID: number; fileID: number; required: boolean }[]; overrides: string
}
export interface ParsedModpack {
  format: 'modrinth' | 'curseforge'
  config: InstanceConfig
  overridesPrefix: string
  overridePrefixes: string[]
  filesToDownload: DownloadFile[]
  references: { projectID: number; fileID: number; required: boolean }[]
  skipped: string[]
}
const LOADER_KEYS: Record<string, LoaderSpec['kind']> = { 'fabric-loader': 'fabric', 'quilt-loader': 'quilt', forge: 'forge', neoforge: 'neoforge' }
function configuration(name: unknown, gameVersion: unknown, loaders: LoaderSpec[], override?: string): InstanceConfig {
  const declaredName = text(name, '整合包名称')
  return { name: override === undefined ? declaredName : text(override, 'name').trim(), gameVersion: version(gameVersion, 'Minecraft 版本'), loaders, memory: { minMb: 2048, maxMb: 6144 }, jvmArgs: [], gameArgs: [], window: { width: 1280, height: 720, fullscreen: false } }
}
function array(value: unknown, label: string): any[] {
  if (!Array.isArray(value) || value.length > MAX_ENTRIES) fail(label + '无效或条目过多', 'INVALID_MANIFEST')
  return value
}
function uniquePaths(files: { path: string }[]): void {
  const seen = new Set<string>()
  for (const file of files) {
    const key = file.path.normalize('NFC').toLowerCase()
    if (seen.has(key)) fail('清单包含重复文件路径：' + file.path, 'UNSAFE_PATH')
    seen.add(key)
  }
  for (const path of seen) {
    const parts = path.split('/')
    for (let i = 1; i < parts.length; i++) if (seen.has(parts.slice(0, i).join('/'))) fail('清单包含文件/目录冲突', 'UNSAFE_PATH')
  }
}
export function parseModrinthIndex(value: unknown, nameOverride?: string): ParsedModpack {
  const index = object(value, 'Modrinth 清单')
  if (index.game !== 'minecraft' || index.formatVersion !== 1) fail('仅支持 game=minecraft、formatVersion=1 的 Modrinth 整合包', 'INVALID_MANIFEST')
  text(index.versionId, 'versionId')
  const dependencies = object(index.dependencies, 'dependencies')
  const loaders: LoaderSpec[] = []
  for (const [key, value] of Object.entries(dependencies)) {
    if (key === 'minecraft') continue
    if (!LOADER_KEYS[key]) fail('不支持的必需依赖：' + key, 'UNSUPPORTED_LOADER')
    loaders.push({ kind: LOADER_KEYS[key], version: version(value, key) })
  }
  if (loaders.length > 1) fail('整合包要求互不兼容的多个加载器', 'UNSUPPORTED_LOADER')
  const config = configuration(index.name, dependencies.minecraft, loaders, nameOverride)
  if (index.summary !== undefined) config.notes = text(index.summary, 'summary', 10000)
  const skipped: string[] = []
  const all: DownloadFile[] = []
  const selected: DownloadFile[] = []
  let total = 0
  for (const value of array(index.files, 'files')) {
    const file = object(value, 'Modrinth 文件')
    const path = packPath(file.path)
    const expected = hashes(file.hashes)
    if (!expected.sha1 || !expected.sha512) fail('Modrinth 文件必须包含 sha1 和 sha512：' + path, 'INVALID_MANIFEST')
    const downloads = array(file.downloads, 'downloads')
    if (!downloads.length || downloads.length > 16) fail('文件没有下载地址或镜像过多：' + path, 'INVALID_MANIFEST')
    // URL validation also applies to server-only entries: malformed manifests fail early.
    const normalized = downloads.map(value => importUrl(value))
    const bytes = size(file.fileSize, 'Modrinth 文件')
    total += bytes
    if (total > MAX_TOTAL_BYTES) fail('整合包下载总大小超出限制', 'INVALID_MANIFEST')
    const entry: DownloadFile = { path, url: normalized[0], mirrors: normalized.slice(1), hashes: expected, size: bytes }
    all.push(entry)
    if (file.env !== undefined) {
      const env = object(file.env, 'file.env')
      for (const side of ['client', 'server']) if (env[side] !== undefined && !['required', 'optional', 'unsupported'].includes(env[side])) fail('未知的文件环境：' + path, 'INVALID_MANIFEST')
      if (env.client === 'unsupported') { skipped.push(path); continue }
    }
    selected.push(entry)
  }
  uniquePaths(all)
  return { format: 'modrinth', config, overridesPrefix: 'overrides/', overridePrefixes: ['overrides/', 'client-overrides/'], filesToDownload: selected, references: [], skipped }
}
import { httpUrl as importUrl } from './safety.ts'

export function parseCurseForgeManifest(value: unknown, nameOverride?: string): ParsedModpack {
  const manifest = object(value, 'CurseForge 清单')
  if (manifest.manifestType !== 'minecraftModpack' || manifest.manifestVersion !== 1) fail('仅支持 manifestType=minecraftModpack、manifestVersion=1 的 CurseForge 整合包', 'INVALID_MANIFEST')
  text(manifest.version, '整合包版本')
  if (typeof manifest.author !== 'string') fail('CurseForge author 无效', 'INVALID_MANIFEST')
  const minecraft = object(manifest.minecraft, 'minecraft')
  const loaders: LoaderSpec[] = []
  const declared = array(minecraft.modLoaders, 'modLoaders').map(value => {
    const loader = object(value, 'modLoader')
    if (typeof loader.primary !== 'boolean') fail('modLoader.primary 必须是布尔值', 'INVALID_MANIFEST')
    const id = text(loader.id, '加载器 ID')
    const match = /^(forge|neoforge|fabric|quilt)-(.+)$/.exec(id)
    if (!match) fail('不支持的必需加载器：' + id, 'UNSUPPORTED_LOADER')
    return { kind: match[1] as LoaderSpec['kind'], version: version(match[2], '加载器版本'), primary: loader.primary }
  })
  const primary = declared.filter(loader => loader.primary)
  if (declared.length && primary.length !== 1) fail('CurseForge 必须指定一个 primary 加载器', 'INVALID_MANIFEST')
  if (primary[0]) loaders.push({ kind: primary[0].kind, version: primary[0].version })
  const config = configuration(manifest.name, minecraft.version, loaders, nameOverride)
  const prefix = relativePath(manifest.overrides, true) + '/'
  if (['manifest.json/', 'modrinth.index.json/'].includes(prefix.toLowerCase())) fail('非法 overrides 目录', 'UNSAFE_PATH')
  const seen = new Set<number>()
  const references = array(manifest.files, 'files').map(value => {
    const file = object(value, 'CurseForge 文件引用')
    for (const key of ['projectID', 'fileID']) if (!Number.isSafeInteger(file[key]) || file[key] <= 0) fail('CurseForge ' + key + '无效', 'INVALID_MANIFEST')
    if (typeof file.required !== 'boolean' || seen.has(file.projectID)) fail('CurseForge 文件引用重复或 required 无效', 'INVALID_MANIFEST')
    seen.add(file.projectID)
    return { projectID: file.projectID as number, fileID: file.fileID as number, required: file.required as boolean }
  })
  return { format: 'curseforge', config, overridesPrefix: prefix, overridePrefixes: [prefix], filesToDownload: [], references, skipped: [] }
}

function detect(archive: PackArchive): 'modrinth' | 'curseforge' {
  const mr = !!archive.entry('modrinth.index.json'), cf = !!archive.entry('manifest.json')
  if (mr === cf) fail(mr ? '整合包同时包含两种清单，格式有歧义' : '无法识别整合包清单', 'INVALID_MANIFEST')
  return mr ? 'modrinth' : 'curseforge'
}
async function plan(archive: PackArchive, expected?: ParsedModpack['format'], name?: string): Promise<ParsedModpack> {
  const format = detect(archive)
  if (expected && expected !== format) fail('整合包格式与导入器不匹配', 'INVALID_MANIFEST')
  const parsed = format === 'modrinth' ? parseModrinthIndex(await archive.json('modrinth.index.json'), name) : parseCurseForgeManifest(await archive.json('manifest.json'), name)
  for (const prefix of parsed.overridePrefixes) {
    const overrides = archive.entries.filter(entry => !entry.isDirectory && entry.name.startsWith(prefix)).map(entry => ({ path: packPath(entry.name.slice(prefix.length)) }))
    uniquePaths(overrides)
  }
  return parsed
}
export async function identifyModpack(input: unknown, env: FeatureEnvironment): Promise<ParsedModpack> {
  const body = object(input)
  check(env)
  const paths = await env.use<RhPaths>('paths.get')
  const source = await stagedSource(paths, body.path, MAX_ARCHIVE_BYTES)
  const archive = await PackArchive.open(source, env)
  try { return await plan(archive, undefined, body.name) } finally { await archive.close() }
}

async function resolveCurseForge(parsed: ParsedModpack, env: FeatureEnvironment): Promise<void> {
  if (!parsed.references.length) return
  const settings = await env.use<Settings>('settings.resolve')
  const key = resolveCurseforgeApiKey(settings.curseforgeApiKey).value
  if (!key) fail('导入 CurseForge 整合包需要配置 CurseForge API Key（环境变量 RHINE_CURSEFORGE_API_KEY 或设置页）', 'CURSEFORGE_API_KEY_REQUIRED', 503)
  const base = apiBase(settings.mirrors.curseforge, 'curseforge')
  let total = 0
  for (const reference of parsed.references) {
    check(env)
    env.task?.setProgress({ stage: 'resolve', message: '解析 CurseForge ' + reference.projectID + '/' + reference.fileID })
    const payload = object(await jsonRequest(base + '/mods/' + reference.projectID + '/files/' + reference.fileID, env, { headers: { 'x-api-key': key } }), 'CurseForge 响应')
    const file = curseFile(payload.data, reference.projectID, reference.fileID)
    // File destinations come from the authoritative project class, not a guessed CDN URL.
    const projectResponse = object(await jsonRequest(base + '/mods/' + reference.projectID, env, { headers: { 'x-api-key': key } }), 'CurseForge 项目响应')
    const project = object(projectResponse.data, 'CurseForge 项目')
    if (project.id !== reference.projectID || project.gameId !== 432) fail('CurseForge 返回了错误的项目或游戏', 'INVALID_RESPONSE', 502)
    if (project.allowModDistribution === false) fail('作者禁止第三方下载，请手动下载 CurseForge 项目 ' + reference.projectID, 'CURSEFORGE_MANUAL_DOWNLOAD', 409)
    const folder = ({ 6: 'mods', 12: 'resourcepacks', 6552: 'shaderpacks' } as Record<number, string>)[project.classId]
    if (!folder) fail('不支持的 CurseForge 内容类型：' + project.classId, 'INVALID_RESPONSE', 502)
    file.path = packPath(folder + '/' + file.fileName)
    total += file.size ?? 0
    if (total > MAX_TOTAL_BYTES) fail('CurseForge 下载总大小超出限制', 'INVALID_MANIFEST')
    parsed.filesToDownload.push(file)
  }
  uniquePaths(parsed.filesToDownload)
}

/** Perform all untrusted/network work before publishing any instance. */
export async function importModpack(input: unknown, env: FeatureEnvironment, format: ParsedModpack['format']): Promise<Instance> {
  const body = object(input)
  check(env)
  const paths = await env.use<RhPaths>('paths.get')
  const source = await stagedSource(paths, body.path, MAX_ARCHIVE_BYTES)
  const archive = await PackArchive.open(source, env)
  let stage: string | undefined
  let created: Instance | undefined
  let committed = false
  try {
    const parsed = await plan(archive, format, body.name)
    if (format === 'curseforge') await resolveCurseForge(parsed, env)
    await directory(paths.temp, true)
    stage = await mkdtemp(join(paths.temp, 'modpack-stage-'))
    for (const path of parsed.skipped) env.task?.log('跳过仅服务端文件：' + path, 'info')
    for (const file of parsed.filesToDownload) {
      check(env)
      await downloadVerified(stage, file, env)
    }
    // Format-defined precedence: index downloads, overrides, then client-overrides.
    for (const prefix of parsed.overridePrefixes) {
      for (const entry of archive.entries) {
        check(env)
        if (entry.isDirectory || !entry.name.startsWith(prefix)) continue
        const path = packPath(entry.name.slice(prefix.length))
        const target = await targetPath(stage, path, true)
        env.task?.setProgress({ stage: 'extract', message: '解压 ' + path })
        await writeFile(target, await archive.read(entry.name), { flag: 'w', mode: 0o600 })
      }
    }
    check(env)
    await env.use<Promise<void>>('version.install', { gameVersion: parsed.config.gameVersion })
    for (const loader of parsed.config.loaders) {
      check(env)
      await env.use('loader.' + loader.kind + '.install', { gameVersion: parsed.config.gameVersion, loaderVersion: loader.version })
    }
    check(env)
    env.task?.setProgress({stage:'write',message:'原子提交整合包实例'})
    const result=await env.use<Promise<Instance>>('instance.import.commit',{stagingPath:stage,config:parsed.config})
    committed=true
    env.task?.setProgress({stage:'done',value:1,message:'整合包导入完成'})
    return result
  } finally {
    try { await archive.close() } finally { if (stage) await rm(stage, { recursive: true, force: true }) }
  }
}
async function copyStage(from: string, to: string, env: FeatureEnvironment): Promise<void> {
  await directory(from)
  await directory(to)
  for (const entry of await readdir(from, { withFileTypes: true })) {
    check(env)
    relativePath(entry.name)
    if (entry.isSymbolicLink()) fail('staging 不允许符号链接', 'UNSAFE_PATH')
    const source = join(from, entry.name)
    const target = join(to, entry.name)
    if (entry.isDirectory()) { await directory(target, true); await copyStage(source, target, env) }
    else { await targetPath(to, entry.name); await rename(source, target) }
  }
}
