/**
 * Pure helpers for the version library: grouping, filtering and install
 * planning. Minecraft version ids changed to a date-based scheme (e.g. 26.3),
 * so nothing here assumes a particular numbering — everything is derived from
 * the manifest returned by the backend.
 */
import type { LoaderKind, LoaderVersion, RemoteVersion } from '@rhine/core'

export type VersionGroup = 'release' | 'snapshot' | 'old'

/** Collapse the four manifest types into the three groups the UI exposes. */
export function groupOf(version: RemoteVersion): VersionGroup {
  if (version.type === 'release') return 'release'
  if (version.type === 'snapshot') return 'snapshot'
  return 'old'
}

export const GROUP_LABELS: Record<VersionGroup, string> = {
  release: '正式版',
  snapshot: '快照',
  old: '远古版本',
}

/** Case-insensitive id search. */
export function matchesVersion(version: RemoteVersion, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  return (version.id + ' ' + version.name).toLowerCase().includes(needle)
}

export interface FilterVersionsInput {
  versions: RemoteVersion[]
  query?: string
  group?: VersionGroup | 'all'
  /** Hide snapshots entirely (mirrors the showSnapshots setting). */
  hideSnapshots?: boolean
  limit?: number
}

/**
 * Filter + sort a manifest for display.
 *
 * Releases are ordered newest-first by release time; the manifest is already
 * chronological, but sorting explicitly keeps the UI stable if the backend
 * reorders it.
 */
export function filterVersions(input: FilterVersionsInput): RemoteVersion[] {
  const { versions, query = '', group = 'all', hideSnapshots = false, limit } = input
  const filtered = versions.filter((version) => {
    if (hideSnapshots && version.type === 'snapshot') return false
    if (group === 'old') {
      if (groupOf(version) !== 'old') return false
    } else if (group !== 'all' && groupOf(version) !== group) {
      return false
    }
    return matchesVersion(version, query)
  })
  const sorted = filtered.slice().sort((a, b) => {
    const left = Date.parse(a.releaseTime)
    const right = Date.parse(b.releaseTime)
    if (Number.isNaN(left) || Number.isNaN(right)) return 0
    return right - left
  })
  return typeof limit === 'number' ? sorted.slice(0, limit) : sorted
}

/** Count per group, used for the filter chips. */
export function countByGroup(versions: RemoteVersion[]): Record<VersionGroup | 'all', number> {
  const counts: Record<VersionGroup | 'all', number> = { all: versions.length, release: 0, snapshot: 0, old: 0 }
  for (const version of versions) counts[groupOf(version)] += 1
  return counts
}

/** Loaders offered by the install dialog, in display order. */
export const INSTALL_LOADERS: { kind: LoaderKind; label: string }[] = [
  { kind: 'vanilla', label: '原版 / Vanilla' },
  { kind: 'fabric', label: 'Fabric' },
  { kind: 'quilt', label: 'Quilt' },
  { kind: 'forge', label: 'Forge' },
  { kind: 'neoforge', label: 'NeoForge' },
]

/**
 * Pick the loader build that should be preselected: the first stable entry,
 * falling back to the first available one.
 */
export function preferredLoaderVersion(list: LoaderVersion[] | undefined | null): string | undefined {
  if (!list || list.length === 0) return undefined
  const stable = list.find((item) => item.stable !== false && item.type !== 'beta')
  return (stable ?? list[0]).version
}

/** True when the id is present in the installed set (case-insensitive). */
export function isInstalled(installed: string[], id: string): boolean {
  const needle = id.toLowerCase()
  return installed.some((item) => item.toLowerCase() === needle)
}

/** Stable display label for a version row. */
export function versionLabel(version: RemoteVersion): string {
  return version.name && version.name !== version.id ? version.name : version.id
}

/** Sort installed ids newest-first using a natural, numeric-aware comparison. */
export function sortInstalled(ids: string[]): string[] {
  return ids.slice().sort((a, b) =>
    a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }),
  ).reverse()
}
