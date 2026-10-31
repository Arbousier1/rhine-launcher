/**
 * Unit tests for the archive grid rules.
 *
 * These are the behaviours a user notices immediately (which card is selected,
 * where an arrow key lands, what the gutter number says), so they are covered
 * exhaustively and without a DOM.
 */
import { describe, expect, it } from 'vitest'
import type { Instance } from '@rhine/core'
import {
  LOADER_NAMES, buildEntries, columnsForWidth, deltaForKey, hasModLoader,
  loaderLabel, matchesQuery, memoryLabel, nextIndex,
} from '../src/pages/instances/archive-logic.ts'

function makeInstance(patch: Partial<Instance> = {}): Instance {
  return {
    id: patch.id ?? 'inst-1',
    name: patch.name ?? '生存周目',
    gameVersion: patch.gameVersion ?? '1.21.4',
    loaders: patch.loaders ?? [{ kind: 'fabric', version: '0.16.9' }],
    memory: patch.memory ?? { minMb: 1024, maxMb: 4096 },
    jvmArgs: patch.jvmArgs ?? [],
    gameArgs: patch.gameArgs ?? [],
    window: patch.window ?? { width: 1280, height: 720, fullscreen: false },
    path: patch.path ?? '/data/instances/inst-1',
    revision: patch.revision ?? 1,
    createdAt: patch.createdAt ?? 1_700_000_000_000,
    playTimeMs: patch.playTimeMs ?? 0,
    ...patch,
  }
}

describe('loaderLabel', () => {
  it('falls back to the vanilla label', () => {
    expect(loaderLabel(undefined)).toBe('原版')
    expect(loaderLabel([])).toBe('原版')
  })

  it('renders kind and version', () => {
    expect(loaderLabel([{ kind: 'fabric', version: '0.16.9' }])).toBe('Fabric 0.16.9')
    expect(loaderLabel([{ kind: 'forge', version: '20.4.237' }])).toBe('Forge 20.4.237')
  })

  it('joins several loaders', () => {
    expect(loaderLabel([{ kind: 'forge', version: '20.4' }, { kind: 'optifine', version: 'HD_U_I6' }])).toBe(
      'Forge 20.4 + OptiFine HD_U_I6',
    )
  })

  it('omits the version when the spec has none', () => {
    expect(loaderLabel([{ kind: 'quilt' }])).toBe('Quilt')
  })

  it('knows every loader kind', () => {
    expect(Object.keys(LOADER_NAMES)).toContain('neoforge')
    expect(LOADER_NAMES.vanilla).toBe('原版')
  })
})

describe('hasModLoader', () => {
  it('is false for vanilla only', () => {
    expect(hasModLoader(makeInstance({ loaders: [] }))).toBe(false)
    expect(hasModLoader(makeInstance({ loaders: [{ kind: 'vanilla' }] }))).toBe(false)
  })

  it('is true when any real loader is attached', () => {
    expect(hasModLoader(makeInstance({ loaders: [{ kind: 'fabric', version: '1' }] }))).toBe(true)
  })
})

describe('matchesQuery', () => {
  const instance = makeInstance({ name: '生存周目', notes: '红石试验' })

  it('matches empty queries', () => {
    expect(matchesQuery(instance, '')).toBe(true)
    expect(matchesQuery(instance, '   ')).toBe(true)
  })

  it('matches name, version and loader case-insensitively', () => {
    expect(matchesQuery(instance, '生存')).toBe(true)
    expect(matchesQuery(instance, '1.21')).toBe(true)
    expect(matchesQuery(instance, 'FABRIC')).toBe(true)
    expect(matchesQuery(instance, 'fabric 0.16')).toBe(true)
    expect(matchesQuery(instance, '红石')).toBe(true)
  })

  it('rejects non-matching needles', () => {
    expect(matchesQuery(instance, '创造')).toBe(false)
  })
})

describe('buildEntries', () => {
  const a = makeInstance({ id: 'a', name: 'A 档案', createdAt: 100, lastLaunchedAt: 300 })
  const b = makeInstance({ id: 'b', name: 'B 档案', createdAt: 200, lastLaunchedAt: 100 })
  const c = makeInstance({ id: 'c', name: 'C 档案', createdAt: 300 })

  it('numbers cards in layout order, zero padded', () => {
    const entries = buildEntries({ instances: [a, b, c], runningIds: [] })
    expect(entries.map((entry) => entry.number)).toEqual(['001', '002', '003'])
  })

  it('sorts by creation time by default', () => {
    const entries = buildEntries({ instances: [c, a, b], runningIds: [] })
    expect(entries.map((entry) => entry.instance.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by name when asked', () => {
    const entries = buildEntries({ instances: [c, a, b], runningIds: [], sort: 'name' })
    expect(entries.map((entry) => entry.instance.id)).toEqual(['a', 'b', 'c'])
  })

  it('sorts by last launch, newest first, with never-launched last', () => {
    const entries = buildEntries({ instances: [a, b, c], runningIds: [], sort: 'recent' })
    expect(entries.map((entry) => entry.instance.id)).toEqual(['a', 'b', 'c'])
  })

  it('filters to running instances', () => {
    const entries = buildEntries({ instances: [a, b, c], runningIds: new Set(['b']), filter: 'running' })
    expect(entries).toHaveLength(1)
    expect(entries[0].instance.id).toBe('b')
    expect(entries[0].running).toBe(true)
  })

  it('accepts an array of running ids', () => {
    const entries = buildEntries({ instances: [a, b, c], runningIds: ['a', 'c'], filter: 'running' })
    expect(entries.map((entry) => entry.instance.id)).toEqual(['a', 'c'])
  })

  it('combines query and filter', () => {
    const entries = buildEntries({
      instances: [a, b, c],
      runningIds: ['a', 'b'],
      filter: 'running',
      query: 'B 档案',
    })
    expect(entries.map((entry) => entry.instance.id)).toEqual(['b'])
  })

  it('renumbers after filtering', () => {
    // Note: a bare "C" would also match the loader label "Fabric", so the
    // needle has to be specific enough to isolate one archive.
    const entries = buildEntries({ instances: [a, b, c], runningIds: [], query: 'C 档案' })
    expect(entries.map((entry) => entry.number)).toEqual(['001'])
    expect(entries.map((entry) => entry.instance.id)).toEqual(['c'])
  })

  it('returns an empty list for an empty input', () => {
    expect(buildEntries({ instances: [], runningIds: [] })).toEqual([])
  })

  it('does not mutate the input array', () => {
    const input = [c, a, b]
    buildEntries({ instances: input, runningIds: [] })
    expect(input.map((item) => item.id)).toEqual(['c', 'a', 'b'])
  })
})

describe('nextIndex', () => {
  it('returns -1 for an empty grid', () => {
    expect(nextIndex(0, 1, 0)).toBe(-1)
  })

  it('steps forward and back', () => {
    expect(nextIndex(1, 1, 5)).toBe(2)
    expect(nextIndex(1, -1, 5)).toBe(0)
  })

  it('clamps at both ends instead of wrapping', () => {
    expect(nextIndex(0, -1, 5)).toBe(0)
    expect(nextIndex(4, 1, 5)).toBe(4)
    expect(nextIndex(0, -3, 5)).toBe(0)
    expect(nextIndex(4, 10, 5)).toBe(4)
  })

  it('treats a negative cursor as the first cell', () => {
    expect(nextIndex(-1, 1, 3)).toBe(1)
    expect(nextIndex(-1, -1, 3)).toBe(0)
  })
})

describe('columnsForWidth', () => {
  it('maps container widths onto the CSS breakpoints', () => {
    expect(columnsForWidth(320)).toBe(1)
    expect(columnsForWidth(559)).toBe(1)
    expect(columnsForWidth(560)).toBe(2)
    expect(columnsForWidth(900)).toBe(3)
    expect(columnsForWidth(1319)).toBe(3)
    expect(columnsForWidth(1320)).toBe(4)
  })
})

describe('deltaForKey', () => {
  it('moves one cell for left/right', () => {
    expect(deltaForKey('ArrowRight', 3)).toBe(1)
    expect(deltaForKey('ArrowLeft', 3)).toBe(-1)
  })

  it('moves one row for up/down', () => {
    expect(deltaForKey('ArrowDown', 3)).toBe(3)
    expect(deltaForKey('ArrowUp', 3)).toBe(-3)
  })

  it('never divides by zero on a single column', () => {
    expect(deltaForKey('ArrowDown', 0)).toBe(1)
  })

  it('ignores unrelated keys', () => {
    expect(deltaForKey('Enter', 3)).toBeNull()
    expect(deltaForKey('a', 3)).toBeNull()
  })
})

describe('memoryLabel', () => {
  it('formats a range', () => {
    expect(memoryLabel(1024, 4096)).toBe('1024–4096 MB')
  })

  it('formats a bare maximum', () => {
    expect(memoryLabel(undefined, 8192)).toBe('8192 MB')
  })

  it('falls back when the maximum is missing', () => {
    expect(memoryLabel(1024, undefined)).toBe('—')
  })
})
