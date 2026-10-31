import type { Context } from '@deepseek-ai/cordis'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import type { InstanceFile, MarketProject, MarketSearchResult, MarketVersion, ProjectType } from '../types.ts'
import type { MarketApi, MarketSearchInput, TaskHandle } from '../contracts.ts'
import { ModrinthClient } from '../market/modrinth.ts'
import { CurseForgeClient } from '../market/curseforge.ts'
import { resolveCurseforgeApiKey } from '../config/secrets.ts'
import { sanitizeFileName } from './mods.ts'

/** Map a market project type onto the instance sub-directory. */
export const PROJECT_DIRECTORIES: Record<ProjectType, string> = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  modpack: 'modpacks',
  datapack: 'datapacks',
  plugin: 'plugins',
}

/**
 * Mod marketplace.
 *
 * Both remote catalogues are wrapped in thin clients that only do HTTP; this
 * service owns the caching, the project-type → directory mapping and the
 * download/install step so it can reuse `ctx.download` and `ctx.tasks`.
 */
export class MarketService implements MarketApi {
  static inject = ['paths', 'settings', 'download', 'instances']

  private modrinthCache?: { base: string; client: ModrinthClient }
  private curseforgeCache?: { base: string; key: string; client: CurseForgeClient }

  constructor(protected ctx: Context) {
  }

  /** The Modrinth client for the currently configured mirror. */
  modrinth(): ModrinthClient {
    const base = this.ctx.settings.resolved().mirrors.modrinth
    if (!this.modrinthCache || this.modrinthCache.base !== base) {
      this.modrinthCache = { base, client: new ModrinthClient({ baseUrl: base }) }
    }
    return this.modrinthCache.client
  }

  /** The CurseForge client; re-resolves the API key (env overrides settings) on every change. */
  curseforge(): CurseForgeClient {
    const settings = this.ctx.settings.resolved()
    const base = settings.mirrors.curseforge
    const key = resolveCurseforgeApiKey(settings.curseforgeApiKey).value ?? ''
    if (!this.curseforgeCache || this.curseforgeCache.base !== base || this.curseforgeCache.key !== key) {
      this.curseforgeCache = { base, key, client: new CurseForgeClient({ baseUrl: base, apiKey: key }) }
    }
    return this.curseforgeCache.client
  }

  async search(input: MarketSearchInput): Promise<MarketSearchResult> {
    const options = {
      query: input.query ?? '',
      projectType: input.projectType,
      gameVersion: input.gameVersion,
      loader: input.loader,
      offset: input.offset ?? 0,
      limit: input.limit ?? 20,
      sort: input.sort,
    }
    if (input.source === 'curseforge') return this.curseforge().search(options)
    return this.modrinth().search(options)
  }

  async project(source: 'modrinth' | 'curseforge', id: string): Promise<MarketProject> {
    if (source === 'curseforge') return this.curseforge().project(id)
    return this.modrinth().project(id)
  }

  async versions(
    source: 'modrinth' | 'curseforge',
    projectId: string,
    filter: { gameVersion?: string; loader?: string } = {},
  ): Promise<MarketVersion[]> {
    if (source === 'curseforge') return this.curseforge().versions(projectId, filter)
    return this.modrinth().versions(projectId, filter)
  }

  async install(instanceId: string, version: MarketVersion, handle?: TaskHandle): Promise<InstanceFile> {
    const instance = this.ctx.instances.get(instanceId)
    if (!instance) throw new Error('实例不存在：' + instanceId)
    const url = await this.resolveDownloadUrl(version)
    if (!url) {
      throw new Error('这个版本没有可下载的文件（作者可能关闭了第三方下载）')
    }
    const projectType = await this.projectTypeOf(version)
    const subdir = PROJECT_DIRECTORIES[projectType] ?? 'mods'
    const directory = join(instance.path, subdir)
    await mkdir(directory, { recursive: true })
    const fileName = sanitizeFileName(version.file.fileName || `${version.projectId}-${version.id}.jar`)
    const target = join(directory, fileName)

    handle?.setProgress({ stage: 'download', value: 0, current: 0, total: 1, message: '下载 ' + fileName })
    handle?.log(`下载 ${fileName}`)
    const size = await this.ctx.download.file({
      url,
      destination: target,
      sha1: version.file.hashes?.sha1,
      sha256: version.file.hashes?.sha256,
      sha512: version.file.hashes?.sha512,
      size: version.file.size > 0 ? version.file.size : undefined,
      skipIfExists: false,
    })
    handle?.throwIfCancelled()
    handle?.setProgress({ stage: 'done', value: 1, current: 1, total: 1 })
    const info = await stat(target)
    return {
      path: subdir + '/' + fileName,
      name: fileName,
      isDirectory: false,
      size: size || info.size,
      modifiedAt: info.mtimeMs,
    }
  }

  /**
   * Obtain a download URL for a version.
   *
   * CurseForge returns `downloadUrl: null` for files whose author disallowed
   * third-party distribution. The official `.../download-url` endpoint can
   * still resolve it for an authorised key; when it cannot, installation fails
   * with a clear message instead of fabricating a CDN path.
   */
  private async resolveDownloadUrl(version: MarketVersion): Promise<string | undefined> {
    const direct = version?.file?.url?.trim()
    if (direct) return direct
    if (version?.source !== 'curseforge' || !version.projectId || !version.id) return undefined
    try {
      return await this.curseforge().downloadUrl(version.projectId, version.id)
    } catch {
      return undefined
    }
  }

  /**
   * Determine the project type for a version.
   *
   * Version payloads do not carry the project type, so fall back to a project
   * lookup when available; the default is a regular mod.
   */
  private async projectTypeOf(version: MarketVersion): Promise<ProjectType> {
    const key = version.source + ':' + version.projectId
    const cached = this.typeCache.get(key)
    if (cached) return cached
    const project = await this.ctx.market.project(version.source, version.projectId)
    this.typeCache.set(key, project.projectType)
    return project.projectType
  }

  /** Small in-memory cache so installing several files only looks up once. */
  private typeCache = new Map<string, ProjectType>()

  /** Drop cached clients (tests / settings change). */
  reset(): void {
    this.modrinthCache = undefined
    this.curseforgeCache = undefined
    this.typeCache.clear()
  }
}

