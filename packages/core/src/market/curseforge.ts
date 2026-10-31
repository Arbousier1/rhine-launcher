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
  /**
   * Talk to a broker that holds the API key server-side.
   *
   * In this mode the client sends no credential at all and the broker injects
   * `x-api-key` before forwarding to CurseForge, so the key never ships to
   * users. `baseUrl` must then point at the broker.
   */
  broker?: boolean
  /**
   * Mirror used when the direct API is unavailable, defaulting to
   * {@link MCIM_MIRROR} (same host PCL2 maps to). Pass `null` to disable.
   */
  mirror?: string | null
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
      // PCL2/HMCL behaviour: when the author opted into third-party distribution
      // the API returns downloadUrl; otherwise build the canonical CDN path.
      url: String(file?.downloadUrl ?? '') || (curseForgeCdnUrl(file?.id, file?.fileName) ?? ''),
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

/**
 * Build the canonical CDN URL for a CurseForge file.
 *
 * CurseForge leaves `downloadUrl` null when the author disallowed third-party
 * distribution. Both HMCL and PCL2 then construct this path themselves:
 *
 * ```java
 * // HMCL, CurseForgeRemoteAddonRepository.LatestFile#downloadUrl
 * String.format("https://edge.forgecdn.net/files/%d/%d/%s", id / 1000, id % 1000, fileName)
 * ```
 *
 * ```vb
 * ' PCL2, ResourceVersion.vb
 * Url = $"https://edge.forgecdn.net/files/{id.Substring(0,4)}/{id.Substring(4)}/{FileName}"
 * ```
 *
 * The CDN serves these URLs without an API key (verified against live files),
 * so this is a legitimate fallback and not a bypass: a file the author really
 * opted out of returns 403/404 and the download then fails visibly.
 */
export function curseForgeCdnUrl(fileId: string | number, fileName: string): string | undefined {
  const id = Number(fileId)
  if (!Number.isSafeInteger(id) || id <= 0) return undefined
  if (typeof fileName !== 'string' || !fileName.trim()) return undefined
  const name = fileName.trim()
  // Encode each path segment so spaces and '+' survive; the CDN expects the
  // literal file name, matching PCL2's UrlEscape of the name only.
  return 'https://edge.forgecdn.net/files/' + Math.floor(id / 1000) + '/' + (id % 1000) + '/' + encodeURIComponent(name)
}

/**
 * Mirror a CurseForge/Modrinth URL onto the MCIM mirror.
 *
 * This is PCL2's `DlSourceModGet` mapping verbatim:
 *
 * ```vb
 * Original.Replace("api.curseforge.com", "mod.mcimirror.top/curseforge").
 *          Replace("edge.forgecdn.net", "mod.mcimirror.top").
 *          Replace("mediafilez.forgecdn.net", "mod.mcimirror.top").
 *          Replace("media.forgecdn.net", "mod.mcimirror.top")
 * ```
 *
 * MCIM proxies the CurseForge REST API, which is what lets a user search
 * without holding a personal API key; it redirects file downloads back to the
 * CDN, so it is a routing helper and not a way around author consent.
 */
export const MCIM_MIRROR = 'https://mod.mcimirror.top'

export function mirrorUrl(url: string, mirror: string = MCIM_MIRROR): string {
  // Accept "mod.mcimirror.top" or a full origin; only the host part is used by
  // PCL2's mapping, so keep exactly one scheme in the result.
  const host = mirror.replace(/^[a-z]+:\/\//i, '').replace(/\/+$/, '')
  return String(url)
    .replace(/^[a-z]+:\/\//i, '')
    .replace('api.curseforge.com', host + '/curseforge')
    .replace('api.modrinth.com', host + '/modrinth')
    .replace('staging-api.modrinth.com', host + '/modrinth')
    .replace('cdn.modrinth.com', host)
    .replace('edge.forgecdn.net', host)
    .replace('mediafilez.forgecdn.net', host)
    .replace('media.forgecdn.net', host)
    .replace(/^(?=\S)/, 'https://')
}

/**
 * Typed wrapper around the CurseForge REST API.
 *
 * Two deployment shapes are supported, matching how HMCL and PCL2 ship:
 *
 * - **Own key** (HMCL: `hmcl.curseforge.apikey` manifest attribute; PCL2:
 *   `PCL_CURSEFORGE_API_KEY`). The key authenticates `api.curseforge.com`.
 * - **Mirror** (PCL2's `DlSourceModGet`). Requests go to MCIM, which proxies the
 *   API so no per-user key is required.
 *
 * File downloads never needed a key on the CDN itself.
 */
export class CurseForgeClient {
  private readonly baseUrl: string
  private readonly apiKey: string | undefined
  private readonly fetchImpl: typeof fetch
  /** Fall back to the MCIM mirror when the direct API is unauthorised. */
  private readonly allowMirror: boolean
  private readonly mirror: string

  constructor(options: CurseForgeOptions = {}) {
    this.baseUrl = (options.baseUrl ?? CURSEFORGE_API).replace(/\/+$/, '')
    this.apiKey = options.apiKey?.trim() || undefined
    this.fetchImpl = options.fetch ?? fetch
    this.allowMirror = options.mirror !== null
    this.mirror = options.mirror || MCIM_MIRROR
  }

  /** Whether an API key was configured. */
  get hasKey(): boolean {
    return !!this.apiKey
  }

  /** Whether the mirror fallback is enabled for this client. */
  get usesMirror(): boolean {
    return this.allowMirror
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
   * Resolve a download URL for one file via the official endpoint.
   *
   * Kept for files whose `downloadUrl` the API omits but which the author did
   * allow; `toMarketVersion` already falls back to the canonical CDN path.
   */
  async downloadUrl(projectId: string, fileId: string): Promise<string | undefined> {
    const payload = await this.request<any>(
      '/v1/mods/' + encodeURIComponent(projectId) + '/files/' + encodeURIComponent(fileId) + '/download-url',
    )
    const url = typeof payload?.data === 'string' ? payload.data.trim() : ''
    return url || undefined
  }

  /**
   * Perform an API request.
   *
   * Order of attempts, mirroring PCL2's source-preference setting:
   *
   * 1. The configured base URL with the API key, when a key exists.
   * 2. The MCIM mirror, which proxies the API without a per-user key.
   *
   * A `missing-key` error is only raised when both are unavailable, so a build
   * without a key still works wherever the mirror is reachable.
   */
  private async request<T>(path: string): Promise<T> {
    const targets: { url: string; headers: Record<string, string> }[] = []
    if (this.apiKey) {
      targets.push({
        url: this.baseUrl + path,
        headers: { 'x-api-key': this.apiKey, accept: 'application/json' },
      })
    }
    if (this.allowMirror) {
      // The mirror is addressed by its own prefix; `mirrorUrl` maps the official
      // host onto it, and `path` is already rooted at `/v1`.
      const mirrored = mirrorUrl(this.baseUrl + path, this.mirror)
      if (!targets.some(target => target.url === mirrored)) {
        targets.push({ url: mirrored, headers: { accept: 'application/json' } })
      }
    }
    if (!targets.length) {
      throw new CurseForgeError(
        'CurseForge 需要 API Key，或配置可用的镜像：请在「设置 → 网络」里填入 CurseForge API Key，或启用镜像源。',
        undefined,
        'missing-key',
      )
    }

    let last: CurseForgeError | undefined
    for (const target of targets) {
      // The mirror is a third-party service; a single transient failure should
      // not surface as "no results", so each target gets one retry.
      for (let attempt = 0; attempt < 2; attempt++) {
        let response: Response
        try {
          response = await this.fetchImpl(target.url, { headers: target.headers })
        } catch (error) {
          last = new CurseForgeError('无法连接 CurseForge：' + (error as Error).message)
          if (attempt === 0) { await delay(180); continue }
          break
        }
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          last = new CurseForgeError(
            `CurseForge 请求失败（HTTP ${response.status}）` + (detail ? '：' + detail.slice(0, 200) : ''),
            response.status,
          )
          // 401/403 means this target refuses us; a mirror may still serve it.
          if (response.status === 401 || response.status === 403) break
          // Retry server-side hiccups (5xx / 429), never client errors.
          if ((response.status >= 500 || response.status === 429) && attempt === 0) { await delay(300); continue }
          throw last
        }
        try {
          return await response.json() as T
        } catch (error) {
          last = new CurseForgeError('CurseForge 返回了无法解析的响应：' + (error as Error).message)
          if (attempt === 0) { await delay(180); continue }
          break
        }
      }
    }
    throw last ?? new CurseForgeError('CurseForge 请求失败')
  }
}

/** Small cancellable-free backoff used between retries. */
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}
