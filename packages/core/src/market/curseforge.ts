/**
 * CurseForge v1 client.
 *
 * CurseForge requires an API key (`x-api-key`) for every request, so the
 * launcher keeps the key in settings and returns a Chinese hint when it is
 * missing instead of failing with a bare 403.
 *
 * Endpoints used:
 *   GET /v1/mods/search?gameId=432&searchFilter=
 *   GET /v1/mods/{id}
 *   GET /v1/mods/{id}/files?gameVersion=&modLoaderType=
 *
 * Docs: https://docs.curseforge.com/rest-api/
 */
import type { MarketProject, MarketSearchResult, MarketVersion, ProjectType } from '../types.ts'

/** CurseForge API root. */
export const CURSEFORGE_API = 'https://api.curseforge.com'

/** CurseForge game id for Minecraft. */
export const MINECRAFT_GAME_ID = 432

/** Class ids used by `/v1/mods/search`. */
export const CURSEFORGE_CLASS_IDS: Record<ProjectType, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552,
  datapack: 6945,
  plugin: 5,
}

/** Mod loader ids accepted by the file listing endpoint. */
export const CURSEFORGE_LOADER_IDS: Record<string, number> = {
  forge: 1,
  liteloader: 3,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
}

/** Raised for any CurseForge failure, including a missing API key. */
export class CurseForgeError extends Error {
  constructor(message: string, readonly status?: number, readonly code?: 'missing-key') {
    super(message)
    this.name = 'CurseForgeError'
  }
}

/** Options for {@link CurseForgeClient}. */
export interface CurseForgeOptions {
  /** `x-api-key` value; pass undefined when the user has not configured one. */
  apiKey?: string
  baseUrl?: string
  fetch?: typeof fetch
}

/** Search parameters understood by {@link CurseForgeClient.search}. */
export interface CurseForgeSearchParams {
  query: string
  projectType?: ProjectType
  gameVersion?: string
  loader?: string
  offset?: number
  limit?: number
  sort?: 'relevance' | 'downloads' | 'follows' | 'updated' | 'newest'
}

/** Map our sort option onto CurseForge's sortField enum. */
export function curseForgeSortField(sort: CurseForgeSearchParams['sort']): number {
  switch (sort) {
    case 'downloads': return 6
    case 'follows': return 2
    case 'updated': return 3
    case 'newest': return 11
    default: return 1
  }
}

/** Map CurseForge class id back to our project type. */
export function projectTypeFromClassId(classId: number | undefined): ProjectType {
  for (const [type, id] of Object.entries(CURSEFORGE_CLASS_IDS)) {
    if (id === classId) return type as ProjectType
  }
  return 'mod'
}

/** Extract a usable mod loader name from a CurseForge mod payload. */
export function curseForgeLoadersOf(mod: any): string[] {
  const out = new Set<string>()
  const latest = Array.isArray(mod?.latestFilesIndexes) ? mod.latestFilesIndexes : []
  for (const entry of latest) {
    const loader = loaderNameOf(entry?.modLoader)
    if (loader) out.add(loader)
  }
  const index = Array.isArray(mod?.latestFiles) ? mod.latestFiles : []
  for (const entry of index) {
    for (const dependency of entry?.dependencies ?? []) void dependency
  }
  return [...out]
}

/** Convert a CurseForge mod loader enum into a name we understand. */
export function loaderNameOf(modLoader: number | undefined): string | undefined {
  switch (modLoader) {
    case 1: return 'forge'
    case 4: return 'fabric'
    case 5: return 'quilt'
    case 6: return 'neoforge'
    case 3: return 'liteloader'
    default: return undefined
  }
}

/** Convert a search hit into {@link MarketProject}. */
export function toMarketProject(mod: any): MarketProject {
  const latest = Array.isArray(mod?.latestFilesIndexes) ? mod.latestFilesIndexes : []
  const gameVersions = new Set<string>()
  for (const entry of latest) if (entry?.gameVersion) gameVersions.add(String(entry.gameVersion))
  const categories = Array.isArray(mod?.categories)
    ? mod.categories.map((category: any) => String(category?.name ?? category)).filter(Boolean)
    : []
  const authors = Array.isArray(mod?.authors) ? mod.authors.map((author: any) => String(author?.name ?? '')).filter(Boolean) : []
  return {
    source: 'curseforge',
    id: String(mod?.id ?? ''),
    slug: String(mod?.slug ?? mod?.id ?? ''),
    title: String(mod?.name ?? ''),
    description: String(mod?.summary ?? ''),
    iconUrl: typeof mod?.logo?.thumbnailUrl === 'string'
      ? mod.logo.thumbnailUrl
      : typeof mod?.logo?.url === 'string' ? mod.logo.url : undefined,
    downloads: Number(mod?.downloadCount) || 0,
    follows: Number(mod?.thumbsUpCount) || 0,
    categories,
    gameVersions: [...gameVersions],
    loaders: curseForgeLoadersOf(mod),
    projectType: projectTypeFromClassId(Number(mod?.classId) || undefined),
    updatedAt: String(mod?.dateModified ?? mod?.dateCreated ?? new Date(0).toISOString()),
    author: authors[0],
  }
}

/** Convert a CurseForge file into {@link MarketVersion}. */
export function toMarketVersion(file: any, projectId: string): MarketVersion {
  const hashes: Record<string, string> = {}
  for (const entry of file?.hashes ?? []) {
    if (entry?.algo === 1) hashes.sha1 = String(entry.value)
    else if (entry?.algo === 2) hashes.md5 = String(entry.value)
  }
  return {
    source: 'curseforge',
    id: String(file?.id ?? ''),
    projectId: String(projectId),
    name: String(file?.displayName ?? file?.fileName ?? ''),
    versionNumber: String(file?.displayName ?? file?.fileName ?? ''),
    releaseType: file?.releaseType === 2 ? 'beta' : file?.releaseType === 3 ? 'alpha' : 'release',
    gameVersions: Array.isArray(file?.gameVersions) ? file.gameVersions.map(String) : [],
    loaders: Array.isArray(file?.gameVersions)
      ? file.gameVersions.map((item: string) => String(item).toLowerCase()).filter((item: string) => item in CURSEFORGE_LOADER_IDS)
      : [],
    downloads: Number(file?.downloadCount) || 0,
    publishedAt: String(file?.fileDate ?? new Date(0).toISOString()),
    file: {
      url: String(file?.downloadUrl ?? ''),
      fileName: String(file?.fileName ?? 'download.jar'),
      size: Number(file?.fileLength) || 0,
      hashes,
    },
    dependencies: Array.isArray(file?.dependencies)
      ? file.dependencies.map((dependency: any) => ({
        projectId: dependency?.modId ? String(dependency.modId) : undefined,
        type: dependency?.relationType === 2 ? 'optional' : dependency?.relationType === 3 ? 'incompatible' : 'required',
      }))
      : [],
  }
}

/** Typed wrapper around the CurseForge REST API. */
export class CurseForgeClient {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined
  private readonly fetchImpl: typeof fetch

  constructor(options: CurseForgeOptions = {}) {
    this.baseUrl = (options.baseUrl ?? CURSEFORGE_API).replace(/\/+$/, '')
    this.apiKey = options.apiKey?.trim() || undefined
    this.fetchImpl = options.fetch ?? fetch
  }

  /** Whether an API key was configured. */
  get hasKey(): boolean {
    return !!this.apiKey
  }

  /** Search mods. */
  async search(params: CurseForgeSearchParams): Promise<MarketSearchResult> {
    const limit = Math.min(50, Math.max(1, Math.round(params.limit ?? 20)))
    const index = Math.max(0, Math.round(params.offset ?? 0))
    const query = new URLSearchParams()
    query.set('gameId', String(MINECRAFT_GAME_ID))
    query.set('searchFilter', params.query ?? '')
    query.set('gameVersion', params.gameVersion ?? '')
    query.set('index', String(index))
    query.set('pageSize', String(limit))
    query.set('sortField', String(curseForgeSortField(params.sort)))
    query.set('sortOrder', 'desc')
    if (params.projectType) query.set('classId', String(CURSEFORGE_CLASS_IDS[params.projectType] ?? 6))
    const loaderId = params.loader ? CURSEFORGE_LOADER_IDS[params.loader.toLowerCase()] : undefined
    if (loaderId) query.set('modLoaderType', String(loaderId))
    const payload = await this.request<any>('/v1/mods/search?' + query.toString())
    const data = Array.isArray(payload?.data) ? payload.data.map(toMarketProject) : []
    return {
      hits: data,
      total: Number(payload?.pagination?.totalCount) || data.length,
      offset: Number(payload?.pagination?.index) || index,
      limit: Number(payload?.pagination?.pageSize) || limit,
    }
  }

  /** Fetch a single project. */
  async project(id: string): Promise<MarketProject> {
    const payload = await this.request<any>('/v1/mods/' + encodeURIComponent(id))
    if (!payload?.data) throw new CurseForgeError('CurseForge 没有返回项目数据')
    return toMarketProject(payload.data)
  }

  /** List files of a project. */
  async versions(
    projectId: string,
    filter: { gameVersion?: string; loader?: string } = {},
  ): Promise<MarketVersion[]> {
    const query = new URLSearchParams()
    if (filter.gameVersion) query.set('gameVersion', filter.gameVersion)
    const loaderId = filter.loader ? CURSEFORGE_LOADER_IDS[filter.loader.toLowerCase()] : undefined
    if (loaderId) query.set('modLoaderType', String(loaderId))
    const suffix = query.toString() ? '?' + query.toString() : ''
    const payload = await this.request<any>('/v1/mods/' + encodeURIComponent(projectId) + '/files' + suffix)
    const files = Array.isArray(payload?.data) ? payload.data : []
    return files.map((file: any) => toMarketVersion(file, projectId))
  }

  /**
   * Resolve the real download URL for one file.
   *
   * CurseForge leaves `downloadUrl` null unless the author permits third-party
   * distribution, so the official `.../download-url` endpoint is the only
   * supported way to obtain a URL. Guessing `edge.forgecdn.net` paths is
   * deliberately not done here: the CDN returns 403 for files whose author
   * opted out, and constructing URLs would bypass that decision.
   */
  async downloadUrl(projectId: string, fileId: string): Promise<string | undefined> {
    const payload = await this.request<any>(
      '/v1/mods/' + encodeURIComponent(projectId) + '/files/' + encodeURIComponent(fileId) + '/download-url',
    )
    const url = typeof payload?.data === 'string' ? payload.data.trim() : ''
    return url || undefined
  }

  /** Perform an authenticated request. */
  private async request<T>(path: string): Promise<T> {
    if (!this.apiKey) {
      throw new CurseForgeError(
        'CurseForge 需要 API Key：请在「设置 → 网络」里填入 CurseForge API Key 后再搜索。',
        undefined,
        'missing-key',
      )
    }
    let response: Response
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
      })
    } catch (error) {
      throw new CurseForgeError('无法连接 CurseForge：' + (error as Error).message)
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new CurseForgeError(
        `CurseForge 请求失败（HTTP ${response.status}）` + (detail ? '：' + detail.slice(0, 200) : ''),
        response.status,
      )
    }
    try {
      return await response.json() as T
    } catch (error) {
      throw new CurseForgeError('CurseForge 返回了无法解析的响应：' + (error as Error).message)
    }
  }
}
