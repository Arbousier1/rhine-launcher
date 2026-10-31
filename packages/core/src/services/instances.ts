import type { Context } from '@deepseek-ai/cordis'
import { readFileSync, readdirSync, lstatSync, realpathSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { cp, mkdir, readdir, readFile, rename, rm, stat, writeFile, lstat } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { InstanceApi, TaskHandle } from '../contracts.ts'
import type { Instance, InstanceConfig, InstanceFile } from '../types.ts'
import { sanitizeId } from './paths.ts'

/** Directory skeleton created for every new instance (matches HMCL's `.minecraft`). */
export const INSTANCE_SKELETON = [
  'mods',
  'config',
  'saves',
  'resourcepacks',
  'shaderpacks',
  'logs',
  'crash-reports',
  '.rhine',
  '.rhine/logs',
]

/** File name of the instance descriptor inside the instance directory. */
export const INSTANCE_FILE = 'instance.json'

/** Default `options.txt` written on creation; Minecraft upgrades it on first run. */
export const DEFAULT_OPTIONS_TXT = [
  'autoJump:false',
  'fov:0.0',
  'guiScale:0',
  'lang:zh_cn',
  'maxFps:120',
  'renderDistance:8',
  'soundCategory_master:1.0',
  'enableVsync:true',
].join('\n') + '\n'

/** Stored descriptor: user config plus the launcher's own bookkeeping. */
export interface StoredInstance extends InstanceConfig {
  createdAt: number
  revision: number
  lastLaunchedAt?: number
  playTimeMs: number
}

/** Sensible defaults for a new instance. */
export function defaultInstanceConfig(name: string, gameVersion: string): InstanceConfig {
  return {
    name,
    gameVersion,
    loaders: [],
    memory: { minMb: 1024, maxMb: 4096 },
    jvmArgs: [],
    gameArgs: [],
    window: { width: 1280, height: 720, fullscreen: false },
  }
}

/** Normalise a user-supplied config, filling in defaults. */
export function normalizeConfig(config: Partial<InstanceConfig> & { name?: string; gameVersion?: string }): InstanceConfig {
  const base = defaultInstanceConfig(config.name?.trim() || '新档案', config.gameVersion?.trim() || '')
  return {
    ...base,
    ...config,
    name: config.name?.trim() || base.name,
    gameVersion: config.gameVersion?.trim() || base.gameVersion,
    loaders: Array.isArray(config.loaders) ? config.loaders.filter((loader) => !!loader?.kind) : [],
    memory: normalizeMemory(config.memory, base.memory),
    jvmArgs: toStringList(config.jvmArgs),
    gameArgs: toStringList(config.gameArgs),
    window: normalizeWindow(config.window, base.window),
  }
}

function normalizeMemory(
  memory: InstanceConfig['memory'] | undefined,
  fallback: InstanceConfig['memory'],
): InstanceConfig['memory'] {
  const minMb = clampInt(memory?.minMb, 256, 65536, fallback.minMb)
  const maxMb = clampInt(memory?.maxMb, 256, 65536, fallback.maxMb)
  return { minMb: Math.min(minMb, maxMb), maxMb }
}

function normalizeWindow(
  window: InstanceConfig['window'] | undefined,
  fallback: InstanceConfig['window'],
): InstanceConfig['window'] {
  return {
    width: clampInt(window?.width, 0, 16384, fallback.width),
    height: clampInt(window?.height, 0, 16384, fallback.height),
    fullscreen: !!window?.fullscreen,
  }
}

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const number = Math.round(Number(value))
  if (!Number.isFinite(number)) return fallback
  return Math.min(max, Math.max(min, number))
}

function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return value.filter((item): item is string => typeof item === 'string' && item.length > 0)
}

/**
 * Guard a user supplied relative path against directory traversal.
 *
 * Returns the resolved absolute path; throws a Chinese error when the path
 * escapes the instance directory or is absolute.
 */
export function resolveInside(root: string, relativePath: string): string {
  const cleaned = (relativePath ?? '').replace(/\\/g, '/').trim()
  if (!cleaned) throw new Error('路径不能为空')
  if (isAbsolute(cleaned) || /^[A-Za-z]:/.test(cleaned)) {
    throw new Error('不允许使用绝对路径：' + relativePath)
  }
  if(/[\x00-\x1f<>|?*]/.test(cleaned) || cleaned.split('/').some(part=>/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:[.]|$)/i.test(part))) throw new Error('路径含非法字符')
  const base = resolve(root)
  const target = resolve(base, cleaned)
  if (target !== base && !target.startsWith(base + sep)) {
    throw new Error('路径越界：' + relativePath)
  }
  let cursor=base
  for(const part of relative(base,target).split(sep).filter(Boolean)){
    cursor=join(cursor,part)
    try { if(lstatSync(cursor).isSymbolicLink()) throw new Error('不允许通过符号链接访问实例文件：'+relativePath) }
    catch(error:any){if(error.code!=='ENOENT')throw error}
  }
  return target
}

/** Convert an absolute path into the POSIX relative form used on the wire. */
export function toWirePath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join('/')
}

/**
 * Instance directory management.
 *
 * Every instance *is* a `.minecraft` directory, so mods, saves and options.txt
 * live exactly where Minecraft expects them. Launcher metadata is kept in
 * `instance.json` next to them, written atomically through {@link StorageApi}.
 */
export class InstanceService implements Omit<InstanceApi,'importModpack'> {
  static inject = ['paths', 'storage', 'bus', 'download']

  /** Cache of loaded instances keyed by id; invalidated on every mutation. */
  private cache = new Map<string, Instance>()

  constructor(protected ctx: Context) {
  }

  list(): Instance[] {
    // Synchronous by contract: callers (bootstrap, server) read it on every request.
    const root = this.ctx.paths.get().instances
    const entries = this.listFolders(root)
    const out: Instance[] = []
    for (const entry of entries) {
      const instance = this.loadSync(entry)
      if (instance) out.push(instance)
    }
    out.sort((a, b) => (b.lastLaunchedAt ?? b.createdAt) - (a.lastLaunchedAt ?? a.createdAt))
    return out
  }

  get(id: string): Instance | undefined {
    const cached = this.cache.get(id)
    if (cached) return cached
    const folder = sanitizeId(id)
    const instance = this.loadSync(folder)
    if (instance) this.cache.set(id, instance)
    return instance
  }

  /** Load one instance, throwing a Chinese error when it does not exist. */
  require(id: string): Instance {
    const instance = this.get(id)
    if (!instance) throw new Error('实例不存在：' + id)
    return instance
  }

  async create(config: InstanceConfig, signal?:AbortSignal): Promise<Instance> {
    signal?.throwIfAborted()
    const normalized = normalizeConfig(config)
    const paths = this.ctx.paths.get()
    await mkdir(paths.instances, { recursive: true })
    let id:string, directory:string
    while(true) {
      signal?.throwIfAborted()
      id=await this.allocateId(this.suggestId(normalized.name,normalized.gameVersion))
      directory=join(paths.instances,id)
      try { await mkdir(directory); break }
      catch(error:any){if(error.code!=='EEXIST')throw error}
    }
    try {
      for (const dir of INSTANCE_SKELETON) {
        signal?.throwIfAborted()
        await mkdir(join(directory,...dir.split('/')),{recursive:true})
      }
      await writeFile(join(directory,'options.txt'),DEFAULT_OPTIONS_TXT,{encoding:'utf8',signal})
      const stored:StoredInstance={...normalized,createdAt:Date.now(),revision:1,playTimeMs:0}
      signal?.throwIfAborted()
      await this.writeStored(directory,stored)
      signal?.throwIfAborted()
      const instance=this.toInstance(id,directory,stored)
      this.cache.set(id,instance)
      this.ctx.bus?.emit({type:'instance',instance})
      return instance
    }catch(error){
      // Rollback owns this freshly reserved directory; it deliberately does not
      // call another feature through an already-aborted invocation.
      this.cache.delete(id)
      await rm(directory,{recursive:true,force:true})
      throw error
    }
  }

  async update(id: string, patch: Partial<InstanceConfig>): Promise<Instance> {
    const current = this.require(id)
    const merged = normalizeConfig({ ...pickConfig(current), ...stripUndefined(patch) })
    const stored = this.readStoredSync(current.path) ?? this.fallbackStored(current)
    const next: StoredInstance = {
      ...stored,
      ...merged,
      revision: this.nextRevision(stored.revision),
    }
    await this.writeStored(current.path, next)
    const instance = this.toInstance(current.id, current.path, next)
    this.cache.set(current.id, instance)
    this.ctx.bus?.emit({ type: 'instance', instance })
    return instance
  }

  async remove(id: string, options: { deleteFiles?: boolean } = {}): Promise<void> {
    const instance = this.require(id)
    const deleteFiles = options.deleteFiles !== false
    if (deleteFiles) {
      await rm(instance.path, { recursive: true, force: true })
    } else {
      // Without deleting files the directory would still show up as an
      // instance, so move the descriptor aside instead of losing user data.
      await rm(join(instance.path, INSTANCE_FILE), { force: true })
    }
    this.cache.delete(id)
    this.ctx.bus?.emit({ type: 'instance-removed', id })
  }

  async duplicate(id: string, name: string): Promise<Instance> {
    const source = this.require(id)
    const config = normalizeConfig({ ...pickConfig(source), name })
    const context = await this.create(config)
    // Copy the game data (but never the launcher's own bookkeeping/logs).
    await cp(source.path, context.path, {
      recursive: true,
      force: true,
      filter: (file) => {
        const relativePath = toWirePath(source.path, file)
        if (!relativePath) return true
        if (relativePath === INSTANCE_FILE) return false
        if (relativePath.startsWith('.rhine')) return false
        return true
      },
    })
    const stored = this.readStoredSync(context.path)
    if (!stored) throw new Error('复制实例后无法读取配置：' + context.path)
    const instance = this.toInstance(context.id, context.path, stored)
    this.cache.set(context.id, instance)
    this.ctx.bus?.emit({ type: 'instance', instance })
    return instance
  }

  /** Commit a fully verified private staging tree atomically; no partial instance is published. */
  async commitImport(stagingPath:string,config:InstanceConfig,signal:AbortSignal):Promise<Instance>{
    signal.throwIfAborted()
    const normalized=normalizeConfig(config),paths=this.ctx.paths.get()
    const source=resolve(stagingPath)
    const rel=relative(resolve(paths.temp),source)
    if(!rel||rel.startsWith('..')||isAbsolute(rel))throw new Error('整合包暂存目录不在本机 staging 内')
    const verify=async(directory:string):Promise<void>=>{
      const info=await lstat(directory)
      if(!info.isDirectory()||info.isSymbolicLink())throw new Error('暂存树不是普通目录')
      for(const item of await readdir(directory,{withFileTypes:true})){
        signal.throwIfAborted()
        if(item.isSymbolicLink())throw new Error('暂存树含符号链接')
        if(item.isDirectory())await verify(join(directory,item.name))
      }
    }
    await verify(source)
    await mkdir(paths.instances,{recursive:true,mode:0o700})
    const nonce=randomUUID(),id=this.suggestId(normalized.name,normalized.gameVersion)+'-'+nonce.slice(0,8)
    const pending=join(paths.instances,'.pending-'+nonce),target=join(paths.instances,id)
    let published=false
    try{
      await cp(source,pending,{recursive:true,errorOnExist:true,force:false})
      await verify(pending)
      for(const directory of INSTANCE_SKELETON)await mkdir(join(pending,directory),{recursive:true})
      const stored:StoredInstance={...normalized,createdAt:Date.now(),revision:1,playTimeMs:0}
      await this.writeStored(pending,stored)
      signal.throwIfAborted()
      if(await exists(target))throw new Error('目标实例已存在')
      await rename(pending,target)
      published=true
      signal.throwIfAborted()
      const instance=this.toInstance(id,target,stored)
      this.cache.set(id,instance)
      this.ctx.bus?.emit({type:'instance',instance})
      return instance
    }catch(error){this.cache.delete(id);if(published)await rm(target,{recursive:true,force:true});throw error}
    finally{await rm(pending,{recursive:true,force:true})}
  }

  async files(id: string, subdir = ''): Promise<InstanceFile[]> {
    const instance = this.require(id)
    const directory = resolveInside(instance.path, subdir || '.')
    const entries = await readdir(directory, { withFileTypes: true }).catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') return []
      throw error
    })
    const files: InstanceFile[] = []
    for (const entry of entries) {
      const absolute = join(directory, entry.name)
      const info = await stat(absolute).catch(() => undefined)
      const isDirectory = entry.isDirectory()
      files.push({
        path: toWirePath(instance.path, absolute),
        name: entry.name,
        isDirectory,
        size: isDirectory ? 0 : info?.size ?? 0,
        modifiedAt: info?.mtimeMs ?? 0,
      })
    }
    files.sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name, 'zh-Hans-CN')
    })
    return files
  }

  async readFile(id: string, relativePath: string): Promise<string> {
    const instance = this.require(id)
    const target = resolveInside(instance.path, relativePath)
    try {
      return await readFile(target, 'utf8')
    } catch (error: any) {
      if (error?.code === 'ENOENT') throw new Error('文件不存在：' + relativePath)
      throw error
    }
  }

  async writeFile(id: string, relativePath: string, content: string, signal?:AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    const instance = this.require(id)
    const target = resolveInside(instance.path, relativePath)
    if(basenameOf(target)===INSTANCE_FILE)throw new Error('请通过实例设置更新 instance.json')
    if(typeof content!=='string'||Buffer.byteLength(content)>1024*1024)throw new Error('文本文件超过 1 MiB 限制')
    await mkdir(dirname(target), { recursive: true })
    const temp = target + '.' + randomUUID() + '.tmp'
    try {
      await writeFile(temp,content,{encoding:'utf8',signal})
      signal?.throwIfAborted()
      resolveInside(instance.path,relativePath)
      await rename(temp,target)
    }catch(error){await rm(temp,{force:true});throw error}
  }

  async deleteFile(id: string, relativePath: string): Promise<void> {
    const instance = this.require(id)
    const target = resolveInside(instance.path, relativePath)
    if (basenameOf(target) === INSTANCE_FILE) throw new Error('不能删除实例配置文件')
    await rm(target, { recursive: true, force: true })
  }

  /* ---------------------------------------------------------------- */
  /* launch bookkeeping (used by LaunchService)                        */
  /* ---------------------------------------------------------------- */

  /** Record a successful start; returns the fresh instance. */
  async markLaunched(id: string): Promise<Instance> {
    const instance = this.require(id)
    const stored = this.readStoredSync(instance.path) ?? this.fallbackStored(instance)
    const next: StoredInstance = {
      ...stored,
      lastLaunchedAt: Date.now(),
      revision: this.nextRevision(stored.revision),
    }
    await this.writeStored(instance.path, next)
    const updated = this.toInstance(instance.id, instance.path, next)
    this.cache.set(instance.id, updated)
    this.ctx.bus?.emit({ type: 'instance', instance: updated })
    return updated
  }

  /** Add elapsed play time after the game exits. */
  async addPlayTime(id: string, elapsedMs: number): Promise<void> {
    if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return
    const instance = this.get(id)
    if (!instance) return
    const stored = this.readStoredSync(instance.path) ?? this.fallbackStored(instance)
    const next: StoredInstance = {
      ...stored,
      playTimeMs: (stored.playTimeMs ?? 0) + Math.round(elapsedMs),
      revision: this.nextRevision(stored.revision),
    }
    await this.writeStored(instance.path, next)
    this.cache.set(instance.id, this.toInstance(instance.id, instance.path, next))
  }

  /** Drop cached instance objects (tests and external edits). */
  reload(): void {
    this.cache.clear()
  }

  /* ---------------------------------------------------------------- */
  /* internals                                                         */
  /* ---------------------------------------------------------------- */

  private suggestId(name: string, gameVersion: string): string {
    const base = sanitizeId(name.trim()).replace(/\s+/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '')
    if (base) return base
    const version = sanitizeId(gameVersion.trim()) || 'instance'
    return version
  }

  private async allocateId(base: string): Promise<string> {
    const root = this.ctx.paths.get().instances
    let candidate = base
    let index = 2
    while (await exists(join(root, candidate))) {
      candidate = base + '-' + index++
    }
    return candidate
  }

  private listFolders(directory: string): string[] {
    try {
      // list() is synchronous by contract and the directory only holds instances.
      return readdirSync(directory, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    } catch {
      return []
    }
  }

  private loadSync(folder: string): Instance | undefined {
    const cached = this.cache.get(folder)
    if (cached) return cached
    const path = join(this.ctx.paths.get().instances, folder)
    const stored = this.readStoredSync(path)
    if (!stored) return undefined
    const instance = this.toInstance(folder, path, stored)
    this.cache.set(folder, instance)
    return instance
  }

  private readStoredSync(directory: string): StoredInstance | undefined {
    try {
      const raw = readFileSync(join(directory, INSTANCE_FILE), 'utf8')
      const parsed = JSON.parse(raw) as Partial<StoredInstance>
      const config = normalizeConfig(parsed)
      return {
        ...config,
        createdAt: Number(parsed.createdAt) || 0,
        revision: Number(parsed.revision) || 1,
        lastLaunchedAt: parsed.lastLaunchedAt ? Number(parsed.lastLaunchedAt) : undefined,
        playTimeMs: Number(parsed.playTimeMs) || 0,
        icon: parsed.icon,
        notes: parsed.notes,
        javaPath: parsed.javaPath,
      }
    } catch {
      return undefined
    }
  }

  private async writeStored(directory: string, stored: StoredInstance): Promise<void> {
    await this.ctx.storage.write(join(directory, INSTANCE_FILE), stored)
  }

  private fallbackStored(instance: Instance): StoredInstance {
    return {
      ...pickConfig(instance),
      createdAt: instance.createdAt,
      revision: instance.revision,
      lastLaunchedAt: instance.lastLaunchedAt,
      playTimeMs: instance.playTimeMs,
    }
  }

  private toInstance(id: string, path: string, stored: StoredInstance): Instance {
    return {
      ...stored,
      id,
      path,
      revision: stored.revision,
      createdAt: stored.createdAt || Date.now(),
      playTimeMs: stored.playTimeMs ?? 0,
    }
  }

  private nextRevision(previous: number): number {
    return Math.max(Math.round(previous) + 1, Date.now())
  }
}

function pickConfig(value: InstanceConfig): InstanceConfig {
  return {
    name: value.name,
    gameVersion: value.gameVersion,
    loaders: value.loaders ?? [],
    javaPath: value.javaPath,
    memory: value.memory,
    jvmArgs: value.jvmArgs ?? [],
    gameArgs: value.gameArgs ?? [],
    window: value.window,
    icon: value.icon,
    notes: value.notes,
  }
}

function stripUndefined<T extends object>(value: T): Partial<T> {
  const out: Partial<T> = {}
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined) (out as any)[key] = item
  }
  return out
}

function basenameOf(path: string): string {
  const parts = path.split(/[\\/]/)
  return parts[parts.length - 1]
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path)
    return true
  } catch {
    return false
  }
}

