/**
 * Pure helpers behind the archive grid.
 *
 * Kept free of React so the filter / sort / key-movement rules can be unit
 * tested directly (see packages/web/test/archive.test.ts).
 */
import type { Instance, LoaderKind, LoaderSpec } from '@rhine/core'

export type ArchiveFilter = 'all' | 'running'
export type ArchiveSort = 'name' | 'recent' | 'created'

export interface ArchiveEntry {
  instance: Instance
  /** 1-based archive number shown in the card gutter. */
  number: string
  running: boolean
}

/** Compact loader summary, e.g. "Fabric 0.16.9" or "原版". */
export function loaderLabel(loaders: LoaderSpec[] | undefined): string {
  if (!loaders || loaders.length === 0) return '原版'
  return loaders
    .map((loader) => {
      const name = LOADER_NAMES[loader.kind] ?? loader.kind
      return loader.version ? name + ' ' + loader.version : name
    })
    .join(' + ')
}

export const LOADER_NAMES: Record<LoaderKind, string> = {
  vanilla: '原版',
  fabric: 'Fabric',
  quilt: 'Quilt',
  forge: 'Forge',
  neoforge: 'NeoForge',
  optifine: 'OptiFine',
  liteloader: 'LiteLoader',
}

/** True when the instance has a non-vanilla loader attached. */
export function hasModLoader(instance: Instance): boolean {
  return (instance.loaders ?? []).some((loader) => loader.kind !== 'vanilla')
}

/** Case-insensitive match across name, version and loader labels. */
export function matchesQuery(instance: Instance, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (!needle) return true
  const haystack = [
    instance.name,
    instance.gameVersion,
    loaderLabel(instance.loaders),
    instance.notes ?? '',
  ]
    .join(' ')
    .toLowerCase()
  return haystack.includes(needle)
}

export interface BuildEntriesInput {
  instances: Instance[]
  /** Instance ids with a live launch session. */
  runningIds: Set<string> | string[]
  query?: string
  filter?: ArchiveFilter
  sort?: ArchiveSort
}

/**
 * Filter + sort instances and attach the archive number.
 *
 * Numbering is assigned after sorting so the gutter always reads 001, 002…
 * in the order the cards are actually laid out.
 */
export function buildEntries(input: BuildEntriesInput): ArchiveEntry[] {
  const { instances, runningIds } = input
  const running = runningIds instanceof Set ? runningIds : new Set(runningIds)
  const query = input.query ?? ''
  const filter = input.filter ?? 'all'
  const sort = input.sort ?? 'created'

  const filtered = instances.filter((instance) => {
    if (filter === 'running' && !running.has(instance.id)) return false
    return matchesQuery(instance, query)
  })

  const sorted = filtered.slice().sort((a, b) => {
    if (sort === 'name') return a.name.localeCompare(b.name, 'zh-Hans-CN')
    if (sort === 'recent') {
      const left = a.lastLaunchedAt ?? 0
      const right = b.lastLaunchedAt ?? 0
      if (right !== left) return right - left
      return b.createdAt - a.createdAt
    }
    return a.createdAt - b.createdAt
  })

  return sorted.map((instance, index) => ({
    instance,
    number: String(index + 1).padStart(3, '0'),
    running: running.has(instance.id),
  }))
}

/**
 * Resolve the index after a keyboard move.
 *
 * Returns the current index when the move would leave the grid (no wrap), so
 * arrow keys feel bounded exactly like a real archive drawer.
 */
export function nextIndex(current: number, delta: number, length: number): number {
  if (length <= 0) return -1
  const safeCurrent = current < 0 ? 0 : current
  const next = safeCurrent + delta
  if (next < 0 || next >= length) return safeCurrent
  return next
}

/** Columns used by the grid at a given container width (mirrors the CSS). */
export function columnsForWidth(width: number): number {
  if (width < 560) return 1
  if (width < 900) return 2
  if (width < 1320) return 3
  return 4
}

/**
 * Delta for an arrow key given the current column count.
 * Up/Down move one row, Left/Right move one cell.
 */
export function deltaForKey(key: string, columns: number): number | null {
  const perRow = Math.max(1, columns)
  switch (key) {
    case 'ArrowRight':
      return 1
    case 'ArrowLeft':
      return -1
    case 'ArrowDown':
      return perRow
    case 'ArrowUp':
      return -perRow
    default:
      return null
  }
}

/** Human label for an instance's memory settings. */
export function memoryLabel(minMb: number | undefined, maxMb: number | undefined): string {
  if (!maxMb) return '—'
  return (minMb ? minMb + '–' : '') + maxMb + ' MB'
}
