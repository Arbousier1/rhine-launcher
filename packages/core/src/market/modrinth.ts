/**
 * Modrinth v2 client.
 *
 * Endpoints used (all public, no API key required):
 *   GET /v2/search?query=&limit=&offset=&facets=
 *   GET /v2/project/{id|slug}
 *   GET /v2/project/{id|slug}/version?game_versions=[]&loaders=[]
 *
 * Docs: https://docs.modrinth.com/api/operations/searchprojects/
 */
import type {
  MarketProject, MarketSearchResult, MarketVersion, ProjectType,
} from '../types.ts'

/** Default API root; overridable through settings.mirrors.modrinth. */
export const MODRINTH_API = 'https://api.modrinth.com'

/** User agent Modrinth asks every client to send. */
export const MODRINTH_USER_AGENT = 'RhineLauncher/0.1.0 (rhine-launcher)'

/** Thrown when Modrinth answers with a non-2xx status. */
export class ModrinthError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'ModrinthError'
  }
}

/** Dependency required by the launcher's market layer. */
export interface ModrinthOptions {
  /** API root, e.g. `https://api.modrinth.com`. */
  baseUrl?: string
  userAgent?: string
  fetch?: typeof fetch
}

/** Search parameters understood by {@link ModrinthClient.search}. */
export interface ModrinthSearchParams {
  query: string
  projectType?: ProjectType
  gameVersion?: string
  loader?: string
  offset?: number
  limit?: number
  sort?: 'relevance' | 'downloads' | 'follows' | 'updated' | 'newest'
}

/** Map the launcher project type onto Modrinth's own taxonomy. */
export const MODRINTH_PROJECT_TYPES: Record<ProjectType, string> = {
  mod: 'mod',
  modpack: 'modpack',
  resourcepack: 'resourcepack',
  shader: 'shader',
  datapack: 'datapack',
  plugin: 'plugin',
}

/** Map a market sort option to Modrinth's index value. */
export function modrinthIndex(sort: ModrinthSearchParams['sort']): string {
  switch (sort) {
    case 'downloads': return 'downloads'
    case 'follows': return 'follows'
    case 'updated': return 'updated'
    case 'newest': return 'newest'
    default: return 'relevance'
  }
}

/**
 * Build the `facets` query value from filters.
 *
 * Modrinth expects a JSON array of arrays; each inner array is an OR group and
 * the groups are ANDed together.
 */
export function buildFacets(params: ModrinthSearchParams): string | undefined {
  const groups: string[][] = []
  if (params.projectType) groups.push([`project_type:${MODRINTH_PROJECT_TYPES[params.projectType] ?? params.projectType}`])
  if (params.gameVersion) groups.push([`versions:${params.gameVersion}`])
  if (params.loader) groups.push([`categories:${params.loader.toLowerCase()}`])
  if (groups.length === 0) return undefined
  return JSON.stringify(groups)
}

/** Map Modrinth's project type back to ours. */
export function projectTypeFromModrinth(value: string | undefined): ProjectType {
  switch (value) {
    case 'modpack': return 'modpack'
    case 'resourcepack': return 'resourcepack'
    case 'shader': return 'shader'
    case 'datapack': return 'datapack'
    case 'plugin': return 'plugin'
    default: return 'mod'
  }
}

/** Loader names used by Modrinth that we also understand. */
export const MODRINTH_LOADERS = ['fabric', 'quilt', 'forge', 'neoforge', 'liteloader', 'rift', 'modloader']

/** Normalise a Modrinth search hit into {@link MarketProject}. */
export function toMarketProject(hit: any): MarketProject {
  return {
    source: 'modrinth',
    id: String(hit.project_id ?? hit.id ?? ''),
    slug: String(hit.slug ?? hit.project_id ?? hit.id ?? ''),
    title: String(hit.title ?? hit.name ?? ''),
    description: String(hit.description ?? ''),
    iconUrl: typeof hit.icon_url === 'string' ? hit.icon_url : undefined,
    downloads: Number(hit.downloads) || 0,
    follows: Number(hit.follows) || 0,
    categories: Array.isArray(hit.display_categories)
      ? hit.display_categories.map(String)
      : Array.isArray(hit.categories) ? hit.categories.map(String) : [],
    gameVersions: Array.isArray(hit.versions) ? hit.versions.map(String) : [],
    loaders: modrinthLoadersOf(hit),
    projectType: projectTypeFromModrinth(hit.project_type ?? (Array.isArray(hit.all_project_types) ? hit.all_project_types[0] : undefined)),
    updatedAt: String(hit.date_modified ?? hit.updated ?? new Date(0).toISOString()),
    author: typeof hit.author === 'string' ? hit.author : undefined,
  }
}

/** Extract loader names from a search hit or project payload. */
export function modrinthLoadersOf(value: any): string[] {
  const tags = new Set<string>()
  for (const key of ['loaders', 'categories', 'display_categories']) {
    const list = value?.[key]
    if (!Array.isArray(list)) continue
    for (const item of list) {
      const text = String(item).toLowerCase()
      if (MODRINTH_LOADERS.includes(text)) tags.add(text)
    }
  }
  return [...tags]
}

/** Convert a Modrinth version payload into {@link MarketVersion}. */
export function toMarketVersion(version: any, projectId?: string): MarketVersion {
  const files = Array.isArray(version?.files) ? version.files : []
  const primary = files.find((file: any) => file?.primary) ?? files[0]
  const hashes: Record<string, string> = {}
  for (const [algorithm, value] of Object.entries(primary?.hashes ?? {})) {
    hashes[String(algorithm)] = String(value)
  }
  return {
    source: 'modrinth',
    id: String(version?.id ?? ''),
    projectId: String(projectId ?? version?.project_id ?? ''),
    name: String(version?.name ?? version?.version_number ?? ''),
    versionNumber: String(version?.version_number ?? ''),
    releaseType: normalizeReleaseType(version?.version_type),
    gameVersions: Array.isArray(version?.game_versions) ? version.game_versions.map(String) : [],
    loaders: Array.isArray(version?.loaders) ? version.loaders.map(String) : [],
    downloads: Number(version?.downloads) || 0,
    publishedAt: String(version?.date_published ?? new Date(0).toISOString()),
    file: {
      url: String(primary?.url ?? ''),
      fileName: String(primary?.filename ?? 'download.jar'),
      size: Number(primary?.size) || 0,
      hashes,
    },
    dependencies: Array.isArray(version?.dependencies)
      ? version.dependencies.map((dependency: any) => ({
        projectId: dependency?.project_id ?? undefined,
        versionId: dependency?.version_id ?? undefined,
        type: dependency?.dependency_type === 'optional'
          ? 'optional'
          : dependency?.dependency_type === 'incompatible' ? 'incompatible' : 'required',
      }))
      : [],
  }
}

function normalizeReleaseType(value: unknown): MarketVersion['releaseType'] {
  if (value === 'beta') return 'beta'
  if (value === 'alpha') return 'alpha'
  return 'release'
}

/** Thin typed wrapper around the Modrinth REST API. */
export class ModrinthClient {
  private readonly baseUrl: string
  private readonly userAgent: string
  private readonly fetchImpl: typeof fetch

  constructor(options: ModrinthOptions = {}) {
    this.baseUrl = (options.baseUrl ?? MODRINTH_API).replace(/\/+$/, '')
    this.userAgent = options.userAgent ?? MODRINTH_USER_AGENT
    this.fetchImpl = options.fetch ?? fetch
  }

  /** Search projects. */
  async search(params: ModrinthSearchParams): Promise<MarketSearchResult> {
    const limit = Math.min(100, Math.max(1, Math.round(params.limit ?? 20)))
    const offset = Math.max(0, Math.round(params.offset ?? 0))
    const query = new URLSearchParams()
    query.set('query', params.query ?? '')
    query.set('limit', String(limit))
    query.set('offset', String(offset))
    query.set('index', modrinthIndex(params.sort))
    const facets = buildFacets(params)
    if (facets) query.set('facets', facets)
    const payload = await this.request<any>('/v2/search?' + query.toString())
    const hits = Array.isArray(payload?.hits) ? payload.hits.map(toMarketProject) : []
    return {
      hits,
      total: Number(payload?.total_hits) || hits.length,
      offset: Number(payload?.offset) || offset,
      limit: Number(payload?.limit) || limit,
    }
  }

  /** Fetch one project by id or slug. */
  async project(id: string): Promise<MarketProject> {
    const payload = await this.request<any>('/v2/project/' + encodeURIComponent(id))
    return toMarketProject({
      ...payload,
      project_id: payload?.id ?? id,
      date_modified: payload?.updated ?? payload?.published,
      loaders: modrinthLoadersOf(payload),
    })
  }

  /** List versions of a project, newest first. */
  async versions(
    projectId: string,
    filter: { gameVersion?: string; loader?: string } = {},
  ): Promise<MarketVersion[]> {
    const query = new URLSearchParams()
    if (filter.gameVersion) query.set('game_versions', JSON.stringify([filter.gameVersion]))
    if (filter.loader) query.set('loaders', JSON.stringify([filter.loader.toLowerCase()]))
    const suffix = query.toString() ? '?' + query.toString() : ''
    const payload = await this.request<any[]>('/v2/project/' + encodeURIComponent(projectId) + '/version' + suffix)
    if (!Array.isArray(payload)) return []
    return payload.map((version) => toMarketVersion(version, projectId))
  }

  /** Perform a request and decode JSON, mapping failures to {@link ModrinthError}. */
  private async request<T>(path: string): Promise<T> {
    let response: Response
    try {
      response = await this.fetchImpl(this.baseUrl + path, {
        headers: { 'user-agent': this.userAgent, accept: 'application/json' },
      })
    } catch (error) {
      throw new ModrinthError('无法连接 Modrinth：' + (error as Error).message)
    }
    if (!response.ok) {
      const detail = await response.text().catch(() => '')
      throw new ModrinthError(
        `Modrinth 请求失败（HTTP ${response.status}）` + (detail ? '：' + detail.slice(0, 200) : ''),
        response.status,
      )
    }
    try {
      return await response.json() as T
    } catch (error) {
      throw new ModrinthError('Modrinth 返回了无法解析的响应：' + (error as Error).message)
    }
  }
}
