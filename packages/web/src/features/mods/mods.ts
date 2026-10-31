/**
 * Pure helpers for the mod list page: filtering, sorting, grouping and
 * presentation of "unreadable jar" warnings.
 *
 * The backend (core ModService) already resolves descriptors, so this module
 * never touches the filesystem — it only classifies the data it receives.
 */
import type { LoaderKind, ModFile, ModMeta } from '@rhine/core'

/** Filter state kept by the mods page. */
export interface ModFilter {
  /** Free text matched against name, file name, id and version. */
  query: string
  /** `all` shows both enabled and disabled files. */
  state: 'all' | 'enabled' | 'disabled'
  /** Loader filter, or `all` when the loader is unknown / irrelevant. */
  loader: LoaderKind | 'all'
  /** `all` keeps every file, `broken` only those without a parsed descriptor. */
  health: 'all' | 'broken' | 'ok'
}

/** Default filter used when the page mounts. */
export const DEFAULT_MOD_FILTER: ModFilter = {
  query: '',
  state: 'all',
  loader: 'all',
  health: 'all',
}

/** Sort key supported by the mod list. */
export type ModSort = 'name' | 'updated' | 'size'

/** Human readable labels for the loader chips. */
export const LOADER_LABELS: Record<LoaderKind, string> = {
  vanilla: '原版',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  optifine: 'OptiFine',
  liteloader: 'LiteLoader',
}

/** Every loader chip offered in the toolbar, in display order. */
export const LOADER_ORDER: LoaderKind[] = ['fabric', 'quilt', 'forge', 'neoforge', 'optifine', 'liteloader']

/**
 * A mod is "unreadable" when the backend could not parse any descriptor.
 * HMCL surfaces these separately because a broken jar silently makes the game
 * crash on startup, so the UI must not bury them in the normal list.
 */
export function isUnreadable(mod: ModFile): boolean {
  const meta = mod.meta
  if (!meta) return true
  return !meta.name && !meta.id
}

/** True when the mod has neither a name nor an id but is still a jar. */
export function displayName(mod: ModFile): string {
  return mod.meta?.name || stripJarSuffix(mod.name) || mod.name
}

/** Remove `.jar` / `.jar.disabled` so the title reads cleanly. */
export function stripJarSuffix(name: string): string {
  return name.replace(/\.jar(\.disabled)?$/i, '')
}

/** Display version with a stable fallback. */
export function displayVersion(mod: ModFile): string {
  return mod.meta?.version || '未知版本'
}

/** Display loader with a stable fallback derived from the descriptor. */
export function displayLoader(mod: ModFile): string {
  const loader = mod.meta?.loader
  if (!loader) return '未知'
  return LOADER_LABELS[loader] ?? loader
}

/** Display game versions compactly (first two + `+N`). */
export function displayGameVersions(meta: ModMeta | undefined, limit = 2): string {
  const list = meta?.gameVersions ?? []
  if (!list.length) return '通用'
  if (list.length <= limit) return list.join(' / ')
  return list.slice(0, limit).join(' / ') + ' +' + (list.length - limit)
}

/** Authors rendered with the launcher's middot separator. */
export function displayAuthors(meta: ModMeta | undefined): string {
  const authors = meta?.authors ?? []
  return authors.length ? authors.join(' · ') : '未标注作者'
}

/**
 * Apply the toolbar filter to a mod list.
 *
 * Matching is case-insensitive and covers the human name, disk name, mod id
 * and version, which is what users usually paste into the search box.
 */
export function filterMods(mods: ModFile[], filter: ModFilter): ModFile[] {
  const query = filter.query.trim().toLowerCase()
  return mods.filter((mod) => {
    if (filter.state === 'enabled' && !mod.enabled) return false
    if (filter.state === 'disabled' && mod.enabled) return false
    if (filter.health === 'broken' && !isUnreadable(mod)) return false
    if (filter.health === 'ok' && isUnreadable(mod)) return false
    if (filter.loader !== 'all') {
      if (filter.loader === 'vanilla') return false
      if (mod.meta?.loader !== filter.loader) return false
    }
    if (!query) return true
    const haystack = [
      displayName(mod),
      mod.name,
      mod.diskName,
      mod.meta?.id ?? '',
      mod.meta?.version ?? '',
    ].join('\u0000').toLowerCase()
    return haystack.includes(query)
  })
}

/** Stable comparator factory so the list never reshuffles on re-render. */
export function sortMods(mods: ModFile[], sort: ModSort, descending = false): ModFile[] {
  const copy = [...mods]
  const factor = descending ? -1 : 1
  copy.sort((a, b) => {
    if (sort === 'size') return (a.size - b.size) * factor
    if (sort === 'updated') return (a.modifiedAt - b.modifiedAt) * factor
    return displayName(a).localeCompare(displayName(b), 'zh-CN') * factor
  })
  return copy
}

/**
 * Split a filtered list into "readable" and "unreadable" buckets so the page
 * can render the failure notice above the table (HMCL behaviour).
 */
export function partitionByHealth(mods: ModFile[]): { readable: ModFile[]; broken: ModFile[] } {
  const readable: ModFile[] = []
  const broken: ModFile[] = []
  for (const mod of mods) (isUnreadable(mod) ? broken : readable).push(mod)
  return { readable, broken }
}

/** Aggregate counters shown in the page header strip. */
export interface ModStats {
  total: number
  enabled: number
  disabled: number
  broken: number
  /** Total bytes of every listed jar (disabled files included). */
  bytes: number
}

/** Compute the header statistics for a mod list. */
export function summarize(mods: ModFile[]): ModStats {
  const stats: ModStats = { total: mods.length, enabled: 0, disabled: 0, broken: 0, bytes: 0 }
  for (const mod of mods) {
    if (mod.enabled) stats.enabled += 1
    else stats.disabled += 1
    if (isUnreadable(mod)) stats.broken += 1
    stats.bytes += mod.size
  }
  return stats
}

/** Which loaders are actually present, used to hide empty filter chips. */
export function presentLoaders(mods: ModFile[]): LoaderKind[] {
  const set = new Set<LoaderKind>()
  for (const mod of mods) {
    const loader = mod.meta?.loader
    if (loader) set.add(loader)
  }
  return LOADER_ORDER.filter((loader) => set.has(loader))
}

/**
 * Suggest the file name used when installing a jar from a URL.
 *
 * Mirrors HMCL's rule: prefer the URL basename, fall back to the mod id and
 * version, and always keep a `.jar` suffix so the backend accepts it.
 */
export function suggestFileName(url: string, fallback = 'downloaded'): string {
  let path = url
  try {
    const parsed = new URL(url)
    path = parsed.pathname
  } catch {
    // Not an absolute URL: treat the whole string as a path.
  }
  const base = decodeURIComponent(path.split('/').pop() ?? '')
  const cleaned = base.split('?')[0].trim()
  if (!cleaned) return fallback + '.jar'
  return cleaned.toLowerCase().endsWith('.jar') ? cleaned : cleaned + '.jar'
}

/**
 * Toggle a mod optimistically: the backend may normalise the disk name, but
 * the row should flip immediately so the switch never feels laggy.
 */
export function withEnabled(mod: ModFile, enabled: boolean): ModFile {
  const bare = mod.diskName.replace(/\.disabled$/i, '')
  return {
    ...mod,
    enabled,
    diskName: enabled ? bare : bare + '.disabled',
    name: enabled ? bare : bare + '.disabled',
    path: mod.path.replace(/\.disabled$/i, '') + (enabled ? '' : '.disabled'),
  }
}
