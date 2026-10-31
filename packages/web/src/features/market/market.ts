/**
 * Pure helpers for the market page (Modrinth + CurseForge).
 *
 * Keeping the query/state shaping here means the React component only renders
 * and the search semantics can be unit tested without a browser.
 */
import type {
  LoaderKind, MarketProject, MarketSource, MarketVersion, ProjectType,
} from '@rhine/core'

/** Everything the search bar and filter row can change. */
export interface MarketQuery {
  source: MarketSource
  query: string
  projectType: ProjectType
  gameVersion: string
  loader: string
  sort: MarketSort
  page: number
  pageSize: number
}

/** Sort modes supported by both providers. */
export type MarketSort = 'relevance' | 'downloads' | 'follows' | 'updated' | 'newest'

/** Neutral defaults; the page overrides gameVersion/loader from the instance. */
export const DEFAULT_MARKET_QUERY: MarketQuery = {
  source: 'modrinth',
  query: '',
  projectType: 'mod',
  gameVersion: '',
  loader: '',
  sort: 'relevance',
  page: 0,
  pageSize: 20,
}

/** Sources rendered as the twin-tab switch in the header. */
export const MARKET_SOURCES: { key: MarketSource; label: string; caption: string }[] = [
  { key: 'modrinth', label: 'Modrinth', caption: 'MODRINTH' },
  { key: 'curseforge', label: 'CurseForge', caption: 'CURSEFORGE' },
]

/** Project types offered by the type selector. */
export const PROJECT_TYPES: { key: ProjectType; label: string }[] = [
  { key: 'mod', label: '模组' },
  { key: 'modpack', label: '整合包' },
  { key: 'resourcepack', label: '资源包' },
  { key: 'shader', label: '光影' },
  { key: 'datapack', label: '数据包' },
]

/** Sort options with Chinese labels. */
export const SORT_OPTIONS: { key: MarketSort; label: string }[] = [
  { key: 'relevance', label: '相关度' },
  { key: 'downloads', label: '下载量' },
  { key: 'follows', label: '关注数' },
  { key: 'updated', label: '最近更新' },
  { key: 'newest', label: '最新发布' },
]

/** Loader choices differ per project type: resource packs and shaders have none. */
export function loaderOptions(projectType: ProjectType): { key: string; label: string }[] {
  if (projectType === 'resourcepack' || projectType === 'shader' || projectType === 'datapack') {
    return []
  }
  return [
    { key: 'fabric', label: 'Fabric' },
    { key: 'forge', label: 'Forge' },
    { key: 'neoforge', label: 'NeoForge' },
    { key: 'quilt', label: 'Quilt' },
  ]
}

/** Instance loader specs collapsed into the market's lowercase loader name. */
export function marketLoaderOf(kind: LoaderKind): string | undefined {
  if (kind === 'vanilla' || kind === 'optifine' || kind === 'liteloader') return undefined
  return kind
}

/**
 * Derive the initial query from the selected instance.
 *
 * HMCL pre-filters the browser by the instance's game version and loader, which
 * is the single biggest usability win of the market page, so we do the same.
 */
export function queryFromInstance(
  instance: { gameVersion?: string; loaders?: { kind: LoaderKind }[] } | undefined,
  base: MarketQuery = DEFAULT_MARKET_QUERY,
): MarketQuery {
  if (!instance) return base
  const loader = instance.loaders?.map((spec) => marketLoaderOf(spec.kind)).find(Boolean)
  return {
    ...base,
    gameVersion: instance.gameVersion ?? base.gameVersion,
    loader: loader ?? base.loader,
  }
}

/**
 * Convert the UI query into the flat payload accepted by `api.market.search`.
 *
 * Empty strings are dropped so the backend can apply its own defaults, and the
 * page index is translated into an offset exactly once.
 */
export function toSearchInput(query: MarketQuery): {
  source: MarketSource
  query: string
  projectType: ProjectType
  gameVersion?: string
  loader?: string
  offset: number
  limit: number
  sort: MarketSort
} {
  return {
    source: query.source,
    query: query.query.trim(),
    projectType: query.projectType,
    gameVersion: query.gameVersion || undefined,
    loader: query.loader || undefined,
    offset: Math.max(0, query.page) * query.pageSize,
    limit: query.pageSize,
    sort: query.sort,
  }
}

/** Total pages for a result set, always at least one. */
export function pageCount(total: number, pageSize: number): number {
  if (pageSize <= 0) return 1
  return Math.max(1, Math.ceil(Math.max(0, total) / pageSize))
}

/** Clamp a requested page into the valid range. */
export function clampPage(page: number, total: number, pageSize: number): number {
  return Math.min(Math.max(0, page), pageCount(total, pageSize) - 1)
}

/** Release-type badge tone mapping. */
export function releaseTone(type: MarketVersion['releaseType']): 'ok' | 'accent' | 'warn' {
  if (type === 'release') return 'ok'
  if (type === 'beta') return 'accent'
  return 'warn'
}

/** Release-type Chinese label. */
export function releaseLabel(type: MarketVersion['releaseType']): string {
  if (type === 'release') return '正式版'
  if (type === 'beta') return '测试版'
  return 'Alpha'
}

/**
 * Sort versions newest-first; the providers already do this but CurseForge
 * occasionally returns file updates out of order.
 */
export function sortVersions(versions: MarketVersion[]): MarketVersion[] {
  return [...versions].sort((a, b) => Date.parse(b.publishedAt) - Date.parse(a.publishedAt))
}

/** Keep only versions compatible with the current filters. */
export function compatibleVersions(
  versions: MarketVersion[],
  filter: { gameVersion?: string; loader?: string },
): MarketVersion[] {
  return versions.filter((version) => {
    if (filter.gameVersion && version.gameVersions.length) {
      if (!version.gameVersions.includes(filter.gameVersion)) return false
    }
    if (filter.loader && version.loaders.length) {
      const loaders = version.loaders.map((loader) => loader.toLowerCase())
      if (!loaders.includes(filter.loader.toLowerCase())) return false
    }
    return true
  })
}

/**
 * Dependency summary for the detail drawer.
 *
 * Only `required` dependencies matter for the warning: optional ones are
 * informational, and incompatible ones are surfaced as a hard notice.
 */
export interface DependencySummary {
  required: number
  optional: number
  incompatible: number
  /** True when the user should be warned before installing. */
  warn: boolean
}

/** Summarise a version's dependency list for the drawer warning banner. */
export function summarizeDependencies(version: MarketVersion | undefined): DependencySummary {
  const summary: DependencySummary = { required: 0, optional: 0, incompatible: 0, warn: false }
  if (!version) return summary
  for (const dep of version.dependencies) {
    if (dep.type === 'required') summary.required += 1
    else if (dep.type === 'optional') summary.optional += 1
    else summary.incompatible += 1
  }
  summary.warn = summary.required > 0 || summary.incompatible > 0
  return summary
}

/** The human sentence shown above the install button. */
export function dependencyMessage(version: MarketVersion | undefined): string {
  const summary = summarizeDependencies(version)
  if (summary.incompatible > 0) return `该版本声明了 ${summary.incompatible} 个不兼容项，安装前请确认`
  if (summary.required > 0) return `该版本需要 ${summary.required} 个前置模组，缺失会导致游戏无法启动`
  if (summary.optional > 0) return `该版本有 ${summary.optional} 个可选前置`
  return ''
}

/** Which instance subdirectory a project type installs into. */
export function targetSubdir(type: ProjectType): string {
  if (type === 'resourcepack') return 'resourcepacks'
  if (type === 'shader') return 'shaderpacks'
  if (type === 'datapack') return 'datapacks'
  return 'mods'
}

/** CurseForge class ids used when translating the project type. */
export function curseforgeClassId(type: ProjectType): number {
  if (type === 'modpack') return 4471
  if (type === 'resourcepack') return 12
  if (type === 'shader') return 6552
  if (type === 'datapack') return 6945
  return 6
}

/** Stable key for list rendering across both providers. */
export function projectKey(project: MarketProject): string {
  return project.source + ':' + project.id
}

/** Compact one-line summary used by the result grid. */
export function projectMetaLine(project: MarketProject): string {
  const parts: string[] = [project.projectType]
  if (project.loaders.length) parts.push(project.loaders.slice(0, 2).join('/'))
  if (project.gameVersions.length) {
    const last = project.gameVersions[project.gameVersions.length - 1]
    parts.push(last + '+')
  }
  return parts.join(' · ')
}

/** Filter out projects whose loaders are unrelated to the current filters. */
export function matchesLoader(project: MarketProject, loader: string): boolean {
  if (!loader) return true
  if (!project.loaders.length) return true
  return project.loaders.some((value) => value.toLowerCase() === loader.toLowerCase())
}
