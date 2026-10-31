/**
 * Unit tests for the version library rules: grouping, filtering and install
 * planning. Minecraft version ids are date-based now (26.3), so nothing here
 * assumes an "1.x" shape.
 */
import { describe, expect, it } from 'vitest'
import type { LoaderVersion, RemoteVersion } from '@rhine/core'
import {
  GROUP_LABELS, INSTALL_LOADERS, countByGroup, filterVersions, groupOf,
  isInstalled, matchesVersion, preferredLoaderVersion, sortInstalled, versionLabel,
} from '../src/pages/versions/versions-logic.ts'

function makeVersion(id: string, type: RemoteVersion['type'], releaseTime: string): RemoteVersion {
  return { id, name: id, type, url: 'https://example.invalid/' + id + '.json', releaseTime }
}

const manifest: RemoteVersion[] = [
  makeVersion('26.4-snapshot-3', 'snapshot', '2026-10-20T10:00:00+00:00'),
  makeVersion('26.3', 'release', '2026-09-01T10:00:00+00:00'),
  makeVersion('26.2', 'release', '2026-06-01T10:00:00+00:00'),
  makeVersion('1.21.4', 'release', '2024-12-03T10:00:00+00:00'),
  makeVersion('b1.7.3', 'old_beta', '2011-07-08T10:00:00+00:00'),
  makeVersion('a1.2.6', 'old_alpha', '2010-12-03T10:00:00+00:00'),
]

describe('groupOf', () => {
  it('maps the four manifest types onto three groups', () => {
    expect(groupOf(makeVersion('x', 'release', ''))).toBe('release')
    expect(groupOf(makeVersion('x', 'snapshot', ''))).toBe('snapshot')
    expect(groupOf(makeVersion('x', 'old_beta', ''))).toBe('old')
    expect(groupOf(makeVersion('x', 'old_alpha', ''))).toBe('old')
  })

  it('has a label for every group', () => {
    expect(GROUP_LABELS.release).toBe('正式版')
    expect(GROUP_LABELS.old).toBe('远古版本')
  })
})

describe('matchesVersion', () => {
  const version = makeVersion('26.3', 'release', '2026-09-01T00:00:00Z')

  it('matches empty queries', () => {
    expect(matchesVersion(version, '')).toBe(true)
  })

  it('matches on id and name, case-insensitively', () => {
    expect(matchesVersion(version, '26.3')).toBe(true)
    expect(matchesVersion(version, '26')).toBe(true)
  })

  it('rejects non-matches', () => {
    expect(matchesVersion(version, '1.20')).toBe(false)
  })
})

describe('filterVersions', () => {
  it('sorts newest first by release time', () => {
    const rows = filterVersions({ versions: manifest, group: 'all' })
    expect(rows.map((row) => row.id)).toEqual([
      '26.4-snapshot-3', '26.3', '26.2', '1.21.4', 'b1.7.3', 'a1.2.6',
    ])
  })

  it('filters to releases only', () => {
    const rows = filterVersions({ versions: manifest, group: 'release' })
    expect(rows.map((row) => row.id)).toEqual(['26.3', '26.2', '1.21.4'])
  })

  it('filters to snapshots only', () => {
    const rows = filterVersions({ versions: manifest, group: 'snapshot' })
    expect(rows.map((row) => row.id)).toEqual(['26.4-snapshot-3'])
  })

  it('groups old_beta and old_alpha together', () => {
    const rows = filterVersions({ versions: manifest, group: 'old' })
    expect(rows.map((row) => row.id)).toEqual(['b1.7.3', 'a1.2.6'])
  })

  it('hides snapshots when the setting asks for it', () => {
    const rows = filterVersions({ versions: manifest, group: 'all', hideSnapshots: true })
    expect(rows.map((row) => row.id)).not.toContain('26.4-snapshot-3')
  })

  it('combines the query with the group', () => {
    const rows = filterVersions({ versions: manifest, group: 'release', query: '26' })
    expect(rows.map((row) => row.id)).toEqual(['26.3', '26.2'])
  })

  it('applies a limit after sorting', () => {
    const rows = filterVersions({ versions: manifest, group: 'all', limit: 2 })
    expect(rows.map((row) => row.id)).toEqual(['26.4-snapshot-3', '26.3'])
  })

  it('keeps unparsable dates in place', () => {
    const rows = filterVersions({
      versions: [makeVersion('a', 'release', 'not a date'), makeVersion('b', 'release', '2026-01-01T00:00:00Z')],
      group: 'all',
    })
    expect(rows).toHaveLength(2)
  })

  it('returns nothing for an empty manifest', () => {
    expect(filterVersions({ versions: [], group: 'all' })).toEqual([])
  })

  it('does not mutate the source array', () => {
    const source = manifest.slice()
    filterVersions({ versions: source, group: 'all' })
    expect(source).toEqual(manifest)
  })
})

describe('countByGroup', () => {
  it('counts each bucket', () => {
    expect(countByGroup(manifest)).toEqual({ all: 6, release: 3, snapshot: 1, old: 2 })
  })

  it('handles an empty manifest', () => {
    expect(countByGroup([])).toEqual({ all: 0, release: 0, snapshot: 0, old: 0 })
  })
})

describe('preferredLoaderVersion', () => {
  const list: LoaderVersion[] = [
    { version: '0.17.0-beta.1', type: 'beta', stable: false },
    { version: '0.16.9', type: 'release', stable: true },
    { version: '0.16.8', type: 'release', stable: true },
  ]

  it('picks the first stable build', () => {
    expect(preferredLoaderVersion(list)).toBe('0.16.9')
  })

  it('falls back to the first entry when nothing is stable', () => {
    expect(preferredLoaderVersion([{ version: '1.0.0-beta', type: 'beta', stable: false }])).toBe('1.0.0-beta')
  })

  it('returns undefined for an empty list', () => {
    expect(preferredLoaderVersion([])).toBeUndefined()
    expect(preferredLoaderVersion(null)).toBeUndefined()
    expect(preferredLoaderVersion(undefined)).toBeUndefined()
  })

  it('treats entries without a stable flag as stable', () => {
    expect(preferredLoaderVersion([{ version: '20.4.237', type: 'release' }])).toBe('20.4.237')
  })
})

describe('isInstalled', () => {
  it('is case-insensitive', () => {
    expect(isInstalled(['26.3'], '26.3')).toBe(true)
    expect(isInstalled(['26.3'], '26.3'.toLowerCase())).toBe(true)
  })

  it('is false for unknown ids', () => {
    expect(isInstalled(['26.3'], '26.2')).toBe(false)
    expect(isInstalled([], '26.3')).toBe(false)
  })
})

describe('versionLabel', () => {
  it('prefers the name when it differs from the id', () => {
    expect(versionLabel({ ...makeVersion('26.3', 'release', '2026-09-01T00:00:00Z'), name: '26.3 (正式)' })).toBe('26.3 (正式)')
  })

  it('falls back to the id', () => {
    expect(versionLabel(makeVersion('26.3', 'release', '2026-09-01T00:00:00Z'))).toBe('26.3')
  })
})

describe('sortInstalled', () => {
  it('sorts newest first with numeric awareness', () => {
    expect(sortInstalled(['1.9', '1.10', '1.21.4', '26.3'])).toEqual(['26.3', '1.21.4', '1.10', '1.9'])
  })

  it('handles an empty list', () => {
    expect(sortInstalled([])).toEqual([])
  })

  it('does not mutate the input', () => {
    const input = ['1.9', '26.3']
    sortInstalled(input)
    expect(input).toEqual(['1.9', '26.3'])
  })
})

describe('INSTALL_LOADERS', () => {
  it('offers vanilla first and covers the main loaders', () => {
    expect(INSTALL_LOADERS[0].kind).toBe('vanilla')
    expect(INSTALL_LOADERS.map((item) => item.kind)).toEqual(
      expect.arrayContaining(['vanilla', 'fabric', 'quilt', 'forge', 'neoforge']),
    )
  })
})
