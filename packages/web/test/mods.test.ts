import { describe, expect, it } from 'vitest'
import type { ModFile } from '@rhine/core'
import {
  DEFAULT_MOD_FILTER, displayAuthors, displayGameVersions, displayLoader, displayName,
  displayVersion, filterMods, isUnreadable, partitionByHealth, presentLoaders, sortMods,
  stripJarSuffix, suggestFileName, summarize, withEnabled,
} from '../src/features/mods/mods.ts'

function mod(partial: Partial<ModFile> & { diskName: string }): ModFile {
  const enabled = !partial.diskName.endsWith('.disabled')
  return {
    path: 'mods/' + partial.diskName,
    name: partial.diskName,
    isDirectory: false,
    size: 1024,
    modifiedAt: 1000,
    enabled,
    ...partial,
  }
}

const sodium = mod({
  diskName: 'sodium-fabric-0.5.8.jar',
  size: 900,
  modifiedAt: 3000,
  meta: {
    id: 'sodium', name: 'Sodium', version: '0.5.8', loader: 'fabric',
    authors: ['jellysquid3'], gameVersions: ['1.20.1', '1.20.2', '1.20.3'],
  },
})
const jei = mod({
  diskName: 'jei-forge-15.2.jar.disabled',
  size: 1500,
  modifiedAt: 5000,
  meta: { id: 'jei', name: 'Just Enough Items', version: '15.2', loader: 'forge' },
})
const broken = mod({ diskName: 'some-old-mod.jar', size: 200, modifiedAt: 1000 })

describe('isUnreadable', () => {
  it('treats jars without a descriptor as broken', () => {
    expect(isUnreadable(broken)).toBe(true)
    expect(isUnreadable(sodium)).toBe(false)
  })

  it('treats a descriptor without name and id as broken', () => {
    expect(isUnreadable(mod({ diskName: 'x.jar', meta: { version: '1.0' } }))).toBe(true)
  })
})

describe('display helpers', () => {
  it('prefers the descriptor name and falls back to the file name', () => {
    expect(displayName(sodium)).toBe('Sodium')
    expect(displayName(broken)).toBe('some-old-mod')
    expect(stripJarSuffix('a.jar.disabled')).toBe('a')
  })

  it('renders version, loader and authors with fallbacks', () => {
    expect(displayVersion(sodium)).toBe('0.5.8')
    expect(displayVersion(broken)).toBe('未知版本')
    expect(displayLoader(sodium)).toBe('Fabric')
    expect(displayLoader(broken)).toBe('未知')
    expect(displayAuthors(sodium.meta)).toBe('jellysquid3')
    expect(displayAuthors(broken.meta)).toBe('未标注作者')
  })

  it('compacts the game version list', () => {
    expect(displayGameVersions(sodium.meta)).toBe('1.20.1 / 1.20.2 +1')
    expect(displayGameVersions(undefined)).toBe('通用')
    expect(displayGameVersions({ gameVersions: ['1.21'] })).toBe('1.21')
  })
})

describe('filterMods', () => {
  const all = [sodium, jei, broken]

  it('returns everything with the default filter', () => {
    expect(filterMods(all, DEFAULT_MOD_FILTER)).toHaveLength(3)
  })

  it('filters by enabled state', () => {
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, state: 'enabled' }).map((m) => m.diskName))
      .toEqual(['sodium-fabric-0.5.8.jar', 'some-old-mod.jar'])
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, state: 'disabled' }).map((m) => m.diskName))
      .toEqual(['jei-forge-15.2.jar.disabled'])
  })

  it('filters by loader', () => {
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, loader: 'forge' }).map((m) => m.meta?.id))
      .toEqual(['jei'])
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, loader: 'quilt' })).toHaveLength(0)
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, loader: 'vanilla' })).toHaveLength(0)
  })

  it('filters by health', () => {
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, health: 'broken' }).map((m) => m.diskName))
      .toEqual(['some-old-mod.jar'])
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, health: 'ok' })).toHaveLength(2)
  })

  it('matches the query case-insensitively across name, id, version and file name', () => {
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, query: 'SODIUM' }).map((m) => m.meta?.id)).toEqual(['sodium'])
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, query: '15.2' }).map((m) => m.meta?.id)).toEqual(['jei'])
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, query: 'some-old' }).map((m) => m.meta)).toEqual([undefined])
    expect(filterMods(all, { ...DEFAULT_MOD_FILTER, query: '   ' })).toHaveLength(3)
  })
})

describe('sortMods', () => {
  it('sorts by name, size and modified time', () => {
    expect(sortMods([sodium, jei, broken], 'name').map(displayName))
      .toEqual(['Just Enough Items', 'Sodium', 'some-old-mod'])
    expect(sortMods([sodium, jei, broken], 'size').map((m) => m.size)).toEqual([200, 900, 1500])
    expect(sortMods([sodium, jei, broken], 'updated').map((m) => m.modifiedAt)).toEqual([1000, 3000, 5000])
    expect(sortMods([sodium, jei], 'size', true).map((m) => m.size)).toEqual([1500, 900])
  })

  it('does not mutate the input array', () => {
    const input = [jei, sodium]
    const output = sortMods(input, 'name')
    expect(input[0]).toBe(jei)
    expect(output).not.toBe(input)
  })
})

describe('partitionByHealth', () => {
  it('splits readable and broken jars', () => {
    const result = partitionByHealth([sodium, broken, jei])
    expect(result.readable.map((m) => m.meta?.id)).toEqual(['sodium', 'jei'])
    expect(result.broken.map((m) => m.diskName)).toEqual(['some-old-mod.jar'])
  })
})

describe('summarize', () => {
  it('counts enabled, disabled, broken and total bytes', () => {
    expect(summarize([sodium, jei, broken])).toEqual({
      total: 3, enabled: 2, disabled: 1, broken: 1, bytes: 900 + 1500 + 200,
    })
  })

  it('handles an empty list', () => {
    expect(summarize([])).toEqual({ total: 0, enabled: 0, disabled: 0, broken: 0, bytes: 0 })
  })
})

describe('presentLoaders', () => {
  it('lists only loaders that occur, in display order', () => {
    expect(presentLoaders([sodium, jei, broken])).toEqual(['fabric', 'forge'])
  })
})

describe('suggestFileName', () => {
  it('keeps jar names and rejects query strings', () => {
    expect(suggestFileName('https://cdn.example.com/a/b/sodium-0.5.8.jar')).toBe('sodium-0.5.8.jar')
    expect(suggestFileName('https://cdn.example.com/a/b/sodium.jar?token=1')).toBe('sodium.jar')
    expect(suggestFileName('https://cdn.example.com/a/b/archive.zip')).toBe('archive.zip.jar')
    expect(suggestFileName('https://cdn.example.com/')).toBe('downloaded.jar')
  })

  it('decodes escaped names and tolerates relative input', () => {
    expect(suggestFileName('https://x/%E6%A8%A1%E7%BB%84.jar')).toBe('模组.jar')
    expect(suggestFileName('local/file.jar')).toBe('file.jar')
  })
})

describe('withEnabled', () => {
  it('renames disk name and path when disabling', () => {
    const disabled = withEnabled(sodium, false)
    expect(disabled.enabled).toBe(false)
    expect(disabled.diskName).toBe('sodium-fabric-0.5.8.jar.disabled')
    expect(disabled.name).toBe('sodium-fabric-0.5.8.jar.disabled')
    expect(disabled.path).toBe('mods/sodium-fabric-0.5.8.jar.disabled')
  })

  it('round-trips back to enabled', () => {
    const enabled = withEnabled(withEnabled(jei, false), true)
    expect(enabled.enabled).toBe(true)
    expect(enabled.diskName).toBe('jei-forge-15.2.jar')
  })
})
