/**
 * Vanilla Minecraft metadata: the piston-meta version manifest, version jsons
 * with `inheritsFrom` resolution, and full vanilla installation.
 *
 * Caching strategy (mirrors HMCL's `DefaultCacheRepository`):
 * - the manifest is cached in memory for ten minutes and persisted to
 *   `<root>/cache/manifest.json` so a restart starts warm;
 * - version jsons are stored under `versions/<id>/<id>.json`, which doubles as
 *   the "installed" marker, and reused when offline;
 * - asset indexes live in `assets/indexes/<id>.json`.
 */
import type { Context } from '@deepseek-ai/cordis'
import { readdir, readFile, stat } from 'node:fs/promises'
import {identifier} from '../plugins/http-input.ts'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { MetaApi, RawVersionJson, TaskHandle } from '../contracts.ts'
import type { RemoteVersion } from '../types.ts'
import type { AssetIndex, VersionManifest } from '../meta/types.ts'
import {
  assetIndexFile,
  assetIndexPath,
  buildInstallPlan,
  clientJarPath,
  parseAssetIndex,
  versionJsonPath,
} from '../meta/install.ts'
import { resolveChain, requiredJava } from '../meta/resolve.ts'
import { currentEnvironment } from '../meta/rules.ts'
import { verifyFile } from './download.ts'

/** How long a fetched manifest stays fresh. */
export const MANIFEST_TTL_MS = 10 * 60 * 1000

/** Default upstream manifest location (settings may override it). */
export const DEFAULT_MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'

/** Cached manifest entry held in memory and on disk. */
interface ManifestCache {
  fetchedAt: number
  versions: RemoteVersion[]
}

/**
 * Game metadata service registered as `ctx.meta`.
 *
 * Everything that needs to know how a version is built (the launch service, the
 * loader installer, the HTTP layer's version list) reads it from here; nothing
 * else talks to piston-meta directly.
 */
export class MetaService implements MetaApi {
  static inject = ['paths', 'storage', 'download', 'settings']

  private cache: ManifestCache | undefined
  private inflight: Promise<RemoteVersion[]> | undefined

  constructor(protected ctx: Context) {
  }

  /** Absolute path of the on-disk manifest cache. */
  manifestFile(): string {
    return join(this.ctx.paths.get().root, 'cache', 'manifest.json')
  }

  /** Manifest url after applying the configured mirror. */
  manifestUrl(): string {
    const mirrors = this.ctx.settings?.resolved?.().mirrors
    return mirrors?.versionManifest || DEFAULT_MANIFEST_URL
  }

  /**
   * Version list from piston-meta, cached for ten minutes.
   *
   * Concurrent callers share one in-flight request so a UI that renders the
   * version page twice does not double-fetch a 280 KB manifest.
   */
  async remoteVersions(): Promise<RemoteVersion[]> {
    const fresh = this.cache
    if (fresh && Date.now() - fresh.fetchedAt < MANIFEST_TTL_MS) return fresh.versions
    if (this.inflight) return this.inflight

    this.inflight = this.loadManifest().finally(() => {
      this.inflight = undefined
    })
    return this.inflight
  }

  private async loadManifest(): Promise<RemoteVersion[]> {
    const logger = this.ctx.logger('meta')
    try {
      const text = await this.ctx.download.text(this.manifestUrl())
      const parsed = JSON.parse(text) as VersionManifest
      if (!Array.isArray(parsed?.versions)) throw new Error('版本清单格式不正确')
      const versions = parsed.versions.map(toRemoteVersion)
      this.cache = { fetchedAt: Date.now(), versions }
      await this.ctx.storage.write(this.manifestFile(), this.cache)
      return versions
    } catch (error) {
      logger.warn('拉取远端版本清单失败，尝试本地缓存: %o', error)
      const stored = await this.ctx.storage.read<ManifestCache | undefined>(this.manifestFile(), undefined)
      if (stored?.versions?.length) {
        // Serve stale data but remember when it was fetched so a later call retries.
        this.cache = { fetchedAt: stored.fetchedAt ?? 0, versions: stored.versions }
        return stored.versions
      }
      throw new Error('无法获取版本清单，请检查网络或镜像设置')
    }
  }

  async remoteVersion(id: string): Promise<RemoteVersion | undefined> {
    const versions = await this.remoteVersions()
    return versions.find((version) => version.id === id)
  }

  /**
   * Read a version json, downloading it when it is neither installed nor cached.
   *
   * @param id — version id (`1.20.1`, `fabric-loader-0.16.9-1.20.1`, ...).
   */
  async versionJson(id: string): Promise<RawVersionJson> {
    identifier(id,'版本 id')
    const local = await this.readLocalJson(id)
    if (local) return local

    const remote = await this.remoteVersion(id)
    if (!remote) throw new Error(`版本 ${id} 不存在`)
    const text = await this.ctx.download.text(remote.url)
    const json = JSON.parse(text) as RawVersionJson
    if(json.id!==id)throw new Error('版本元数据 id 与请求不一致')
    // Only vanilla versions may be written here: loader versions own their file
    // and are produced by `ctx.loader.install`.
    await this.ctx.storage.write(versionJsonPath(this.ctx.paths.get().versions, id), json)
    return json
  }

  /** Read `versions/<id>/<id>.json` if present. */
  private async readLocalJson(id: string): Promise<RawVersionJson | undefined> {
    const file = versionJsonPath(this.ctx.paths.get().versions, id)
    try {
      return JSON.parse(await readFile(file, 'utf8')) as RawVersionJson
    } catch {
      return undefined
    }
  }

  /**
   * Resolve the inheritance chain, child first.
   *
   * Loader jsons point at the vanilla version through `inheritsFrom`; the depth
   * is bounded so a broken json cannot loop forever.
   */
  async versionChain(id: string): Promise<RawVersionJson[]> {
    const chain: RawVersionJson[] = []
    const seen = new Set<string>()
    let current: string | undefined = id
    while (current) {
      if (seen.has(current)) throw new Error(`版本 ${id} 的继承链存在循环引用`)
      seen.add(current)
      const json = await this.versionJson(current)
      chain.push(json)
      current = typeof json.inheritsFrom === 'string' && json.inheritsFrom ? json.inheritsFrom : undefined
      if (chain.length > 16) throw new Error(`版本 ${id} 的继承链过深`)
    }
    return chain
  }

  async resolvedJson(id: string): Promise<RawVersionJson> {
    const chain = await this.versionChain(id)
    const merged = resolveChain(chain)
    return { ...merged, id }
  }

  /** A metadata-only cache entry is not an installed game. */
  async installed(): Promise<string[]> {
    const versionsRoot = this.ctx.paths.get().versions
    try {
      const entries = await readdirSafe(versionsRoot)
      const ids: string[] = []
      for (const entry of entries) {
        if (await this.hasClient(entry,new Set())) ids.push(entry)
      }
      return ids.sort()
    } catch {
      return []
    }
  }

  /**
   * Install a vanilla version.
   *
   * Writes the version json first so a partially installed version is visible
   * to {@link isInstalled} as incomplete, then downloads libraries, natives,
   * the client jar, the asset index and finally every asset object.
   */
  async install(gameVersion: string, handle?: TaskHandle): Promise<void> {
    const logger = this.ctx.logger('meta')
    const paths = this.ctx.paths.get()
    const env = currentEnvironment()

    handle?.setProgress({ stage: 'resolve', value: 0, current: 0, total: 0, message: `解析版本 ${gameVersion}` })
    const json = await this.versionJson(gameVersion)
    const indexes = this.ctx.settings.resolved().mirrors.assets
    const assetIndexFileItem = assetIndexFile(json, paths.assets)
    let assetIndex: AssetIndex | undefined
    if (assetIndexFileItem) {
      handle?.throwIfCancelled()
      handle?.setProgress({ stage: 'download', value: 0.02, current: 0, total: 0, message: '下载资源索引' })
      await this.ctx.download.file(assetIndexFileItem)
      const raw = JSON.parse(await readFile(assetIndexFileItem.destination, 'utf8')) as unknown
      assetIndex = parseAssetIndex(raw)
    }

    const plan = buildInstallPlan(json, paths, env, assetIndex, indexes)
    const total = plan.files.length
    handle?.setProgress({
      stage: 'download',
      value: 0.05,
      current: 0,
      total,
      message: `准备下载 ${total} 个文件`,
    })

    const java = requiredJava(json)
    logger.info('安装 %s（需要 Java %d，%d 个文件）', gameVersion, java.majorVersion, total)

    // The version json must exist before the downloader runs so a cancelled
    // install never leaves a version that claims to be complete.
    await this.ctx.storage.write(versionJsonPath(paths.versions, gameVersion), json)

    let completed = 0
    const report = () => {
      completed++
      handle?.setProgress({
        stage: 'download',
        value: total === 0 ? 1 : Math.min(0.99, 0.05 + 0.94 * (completed / total)),
        current: completed,
        total,
      })
    }

    await this.ctx.download.batch(
      plan.files.map((file) => ({
        url: file.url,
        destination: file.destination,
        sha1: file.sha1,
        size: file.size,
        skipIfExists: true,
      })),
      handle,
    )
    completed = total
    report()

    handle?.setProgress({ stage: 'verify', value: 0.995, current: total, total, message: '校验客户端' })
    const jarOk = await verifyJar(clientJarPath(paths.versions, gameVersion), json.downloads?.['client']?.sha1)
    if (!jarOk) throw new Error(`客户端 jar 校验失败: ${gameVersion}`)

    // Natives are extracted at launch time by the launch service; the jars are
    // already on disk at this point.
    if (assetIndexFileItem && !existsSync(assetIndexPath(paths.assets, json.assetIndex?.id ?? gameVersion))) {
      await this.ctx.storage.write(assetIndexPath(paths.assets, json.assetIndex?.id ?? gameVersion), assetIndex)
    }

    handle?.setProgress({ stage: 'done', value: 1, current: total, total, message: '安装完成' })
    logger.info('版本 %s 安装完成', gameVersion)
  }

  /**
   * True when the version json exists *and* the client jar matches its SHA1.
   *
   * Loader versions inherit the client jar from vanilla, so they are considered
   * installed once their own json exists.
   */
  private async hasClient(id:string,seen:Set<string>):Promise<boolean>{
    if(seen.has(id)||seen.size>16)return false
    try{identifier(id);seen.add(id);const json=await this.readLocalJson(id);if(!json)return false;if(typeof json.inheritsFrom==='string'&&json.inheritsFrom)return this.hasClient(json.inheritsFrom,seen);const info=await stat(clientJarPath(this.ctx.paths.get().versions,typeof json.jar==='string'?identifier(json.jar):id));return info.isFile()&&info.size>0}catch{return false}
  }

  async isInstalled(id: string,seen=new Set<string>()): Promise<boolean> {
    if(seen.has(id)||seen.size>16)return false
    identifier(id,'版本 id');seen.add(id)
    const paths = this.ctx.paths.get()
    const jsonFile = versionJsonPath(paths.versions, id)
    if (!existsSync(jsonFile)) return false
    let json: RawVersionJson
    try {
      json = JSON.parse(await readFile(jsonFile, 'utf8')) as RawVersionJson
    } catch {
      return false
    }
    if (typeof json.inheritsFrom === 'string' && json.inheritsFrom) return this.isInstalled(json.inheritsFrom,seen)
    return verifyJar(clientJarPath(paths.versions, id), json.downloads?.['client']?.sha1)
  }

  /** Read the cached asset index, downloading it when needed. */
  async assetIndex(json: RawVersionJson): Promise<AssetIndex | undefined> {
    const paths = this.ctx.paths.get()
    const id = json.assetIndex?.id ?? json.assets ?? json.id
    const file = assetIndexPath(paths.assets, id)
    if (existsSync(file)) {
      try {
        return parseAssetIndex(JSON.parse(await readFile(file, 'utf8')))
      } catch {
        // Fall through and re-download a corrupted index.
      }
    }
    const item = assetIndexFile(json, paths.assets)
    if (!item) return undefined
    await this.ctx.download.file(item)
    return parseAssetIndex(JSON.parse(await readFile(item.destination, 'utf8')))
  }
}

function toRemoteVersion(entry: VersionManifest['versions'][number]): RemoteVersion {
  return {
    id: entry.id,
    type: entry.type,
    url: entry.url,
    releaseTime: entry.releaseTime ?? entry.time,
    sha1: entry.sha1,
    name: entry.id,
  }
}

async function verifyJar(path: string, sha1: string | undefined): Promise<boolean> {
  try {
    const info = await stat(path)
    if (!info.isFile() || info.size === 0) return false
    return sha1 ? await verifyFile(path, sha1) : true
  } catch {
    return false
  }
}

async function readdirSafe(path: string): Promise<string[]> {
  try {
    return await readdir(path)
  } catch {
    return []
  }
}

