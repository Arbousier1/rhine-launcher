import type { FeatureEnvironment } from '@rhine/plugin-api'
import { copyFile, lstat, mkdtemp, readdir, rename, rm } from 'node:fs/promises'
import { constants } from 'node:fs'
import { basename, join } from 'node:path'
import type { RhPaths } from '../contracts.ts'
import type { Instance, ModFile, ModMeta } from '../types.ts'
import { DESCRIPTOR_FILES, fallbackMeta, mimeOf, parseForgeToml, parseJsonDescriptor, parseManifest, parseMcmodInfo, MAX_ICON_BYTES } from '../mods/descriptor.ts'
import { PackArchive } from '../modpack/archive.ts'
import { downloadVerified } from '../modpack/network.ts'
import { check, directory, fail, fileName, fingerprint, hashes, inside, maybeStat, object, sameFile, stagedSource, targetPath, type Hashes } from '../modpack/safety.ts'

export const DISABLED_SUFFIX = '.disabled'
export const MOD_EXTENSIONS = ['.jar', '.litemod', '.zip']
export function stripDisabled(diskName: string): string {
  return diskName.toLowerCase().endsWith(DISABLED_SUFFIX) ? diskName.slice(0, -DISABLED_SUFFIX.length) : diskName
}
export function withEnabled(diskName: string, enabled: boolean): string {
  return stripDisabled(diskName) + (enabled ? '' : DISABLED_SUFFIX)
}
export function isModFile(diskName: string): boolean {
  return MOD_EXTENSIONS.some(extension => stripDisabled(diskName).toLowerCase().endsWith(extension))
}
export function modName(value: unknown): string {
  const name = fileName(value)
  if (!isModFile(name)) fail('只允许 .jar、.litemod 或 .zip 模组文件')
  return name
}
/** Retained for catalogue display compatibility. Mutating actions reject, not sanitize. */
export function sanitizeFileName(fileName: string): string {
  const base = basename((fileName || '').replace(/\\/g, '/'))
  let safe = base.replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').trim()
  if (!safe || safe === '.' || safe === '..') safe = 'download.jar'
  if (/^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i.test(safe)) safe = '_' + safe
  if (safe.length > 180) {
    const dot = safe.lastIndexOf('.')
    safe = dot > 0 ? safe.slice(0, 170) + safe.slice(dot) : safe.slice(0, 180)
  }
  return safe
}

/** Shared lock data, not a feature service. CRUD and apply serialize per instance. */
export async function withModLock<T>(env: FeatureEnvironment, id: string, body: () => Promise<T>): Promise<T> {
  const locks = env.state('content.mod-locks', () => new Map<string, Promise<void>>())
  const previous = locks.get(id) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve })
  const queued = previous.then(() => gate)
  locks.set(id, queued)
  await previous
  try { check(env); return await body() }
  finally { release(); if (locks.get(id) === queued) locks.delete(id) }
}

/** Pure filesystem implementation. Never extends Service or registers a Context namespace. */
export class ModService {
  constructor(private env: FeatureEnvironment) {}

  async modsDirectory(instanceId: string, create = false): Promise<string | undefined> {
    check(this.env)
    const instance = await this.env.use<Instance | undefined>('instance.get', { id: instanceId })
    if (!instance) fail('实例不存在：' + instanceId, 'NOT_FOUND', 404)
    const paths = await this.env.use<RhPaths>('paths.get')
    inside(paths.instances, instance.path)
    await directory(instance.path)
    const path = join(instance.path, 'mods')
    if (!create && !await maybeStat(path)) return undefined
    return directory(path, create)
  }
  async describe(path: string): Promise<ModFile> {
    check(this.env)
    const info = await lstat(path)
    if (info.isSymbolicLink() || !info.isFile()) fail('模组不是普通文件', 'UNSAFE_PATH')
    const diskName = basename(path)
    let meta: ModMeta | undefined
    try { meta = await this.inspectArchive(path) }
    catch (error) {
      check(this.env)
      // A corrupt archive remains visible; only descriptor display falls back.
      this.env.task?.log('无法解析模组 ' + diskName + '：' + (error as Error).message, 'warn')
      meta = fallbackMeta(path)
    }
    return { path: 'mods/' + diskName, name: stripDisabled(diskName), isDirectory: false, size: info.size, modifiedAt: info.mtimeMs, diskName, enabled: !diskName.toLowerCase().endsWith(DISABLED_SUFFIX), meta }
  }
  async list(instanceId: string): Promise<ModFile[]> {
    const path = await this.modsDirectory(instanceId)
    if (!path) return []
    const result: ModFile[] = []
    for (const entry of await readdir(path, { withFileTypes: true })) {
      check(this.env)
      if (!isModFile(entry.name)) continue
      if (entry.isSymbolicLink()) fail('mods 目录中含有符号链接：' + entry.name, 'UNSAFE_PATH')
      if (!entry.isFile()) continue
      result.push(await this.describe(await targetPath(path, entry.name)))
    }
    return result.sort((a, b) => a.name.localeCompare(b.name))
  }
  async setEnabled(instanceId: string, diskName: string, enabled?: boolean): Promise<ModFile> {
    modName(diskName)
    if (enabled !== undefined && typeof enabled !== 'boolean') fail('enabled 必须是布尔值')
    return withModLock(this.env, instanceId, async () => {
      const path = (await this.modsDirectory(instanceId, true))!
      const current = await targetPath(path, diskName)
      if (!await maybeStat(current)) fail('模组不存在：' + diskName, 'NOT_FOUND', 404)
      const desired = enabled ?? diskName.toLowerCase().endsWith(DISABLED_SUFFIX)
      const name = withEnabled(diskName, desired)
      const target = await targetPath(path, name)
      if (target !== current) {
        if (await maybeStat(target)) fail('目标模组已存在：' + name, 'FILE_EXISTS', 409)
        check(this.env)
        await rename(current, target)
      }
      return this.describe(target)
    })
  }
  async remove(instanceId: string, diskName: string): Promise<void> {
    modName(diskName)
    return withModLock(this.env, instanceId, async () => {
      const path = (await this.modsDirectory(instanceId, true))!
      const target = await targetPath(path, diskName)
      if (!await maybeStat(target)) fail('模组不存在：' + diskName, 'NOT_FOUND', 404)
      check(this.env)
      await rm(target)
    })
  }
  async install(instanceId: string, url: string, name: string, expected: { hashes?: Hashes; size?: number } = {}): Promise<ModFile> {
    name = modName(name)
    return withModLock(this.env, instanceId, async () => {
      const path = (await this.modsDirectory(instanceId, true))!
      const target = await this.unoccupied(path, name)
      const stage = await mkdtemp(join(path, '.install-'))
      try {
        await downloadVerified(stage, { path: name, url, hashes: hashes(expected.hashes ?? {}, false), size: expected.size }, this.env)
        await this.inspectArchive(join(stage, name))
        check(this.env)
        await this.unoccupied(path, name)
        await rename(join(stage, name), target)
        this.env.task?.setProgress({ stage: 'done', value: 1 })
        return this.describe(target)
      } finally { await rm(stage, { recursive: true, force: true }) }
    })
  }
  async import(instanceId: string, input: unknown): Promise<ModFile> {
    const body = object(input)
    const paths = await this.env.use<RhPaths>('paths.get')
    const source = await stagedSource(paths, body.path)
    const name = modName(body.fileName ?? basename(source))
    return withModLock(this.env, instanceId, async () => {
      const path = (await this.modsDirectory(instanceId, true))!
      const target = await this.unoccupied(path, name)
      const stage = await mkdtemp(join(path, '.import-'))
      try {
        const before = await fingerprint(source, this.env)
        const staged = join(stage, name)
        await copyFile(source, staged, constants.COPYFILE_EXCL)
        const copied = await fingerprint(staged, this.env)
        if (before.hashes.sha256 !== copied.hashes.sha256 || !sameFile(before, await fingerprint(source, this.env))) fail('导入源文件已变化', 'FILE_CHANGED', 409)
        await this.inspectArchive(staged)
        check(this.env)
        await this.unoccupied(path, name)
        await rename(staged, target)
        return this.describe(target)
      } finally { await rm(stage, { recursive: true, force: true }) }
    })
  }
  async inspect(input: unknown): Promise<ModMeta | undefined> {
    const body = typeof input === 'string' ? { path: input } : object(input)
    const paths = await this.env.use<RhPaths>('paths.get')
    try {
      const source = body.id || body.instanceId
        ? await targetPath((await this.modsDirectory(body.id ?? body.instanceId, true))!, modName(body.diskName))
        : await stagedSource(paths, body.path ?? body.jarPath)
      if (!await maybeStat(source)) return undefined
      return this.inspectArchive(source)
    } catch(error:any) { if(error.code==='ENOENT')return undefined; throw error }
  }
  async inspectArchive(path: string): Promise<ModMeta | undefined> {
    const archive = await PackArchive.open(path, this.env)
    try {
      for (const candidate of DESCRIPTOR_FILES) {
        const entry = archive.entries.find(entry => entry.name.toLowerCase() === candidate.file.toLowerCase())
        if (!entry) continue
        const text = (await archive.read(entry.name, 4 * 1024 * 1024)).toString('utf8')
        const meta = candidate.file.endsWith('.toml') ? parseForgeToml(text, candidate.loader)
          : candidate.file === 'mcmod.info' ? parseMcmodInfo(text)
          : candidate.file.endsWith('.MF') ? parseManifest(text)
          : parseJsonDescriptor(text, candidate.file, candidate.loader)
        if (!meta) continue
        meta.loader ??= candidate.loader
        if (meta.icon) {
          const icon = archive.entry(meta.icon)
          const mime = mimeOf(meta.icon)
          if (icon && mime && mime !== 'image/svg+xml' && icon.uncompressedSize <= MAX_ICON_BYTES) meta.icon = 'data:' + mime + ';base64,' + (await archive.read(icon.name, MAX_ICON_BYTES)).toString('base64')
          else delete meta.icon
        }
        return meta
      }
      return fallbackMeta(path)
    } finally { await archive.close() }
  }
  private async unoccupied(path: string, name: string): Promise<string> {
    const target = await targetPath(path, name)
    const other = await targetPath(path, withEnabled(name, name.toLowerCase().endsWith(DISABLED_SUFFIX)))
    if (await maybeStat(target) || await maybeStat(other)) fail('同名模组已存在：' + name, 'FILE_EXISTS', 409)
    return target
  }
}
