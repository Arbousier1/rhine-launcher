import { describe, expect, it } from 'vitest'
import type { MarketProject, MarketVersion } from '@rhine/core'
import {
  DEFAULT_MARKET_QUERY, clampPage, compatibleVersions, curseforgeClassId, dependencyMessage,
  dependencyMessage as depMsg, loaderOptions, marketLoaderOf, matchesLoader, pageCount,
  projectKey, projectMetaLine, queryFromInstance, releaseLabel, releaseTone, sortVersions,
  summarizeDependencies, targetSubdir, toSearchInput,
} from '../src/features/market/market.ts'

function version(partial: Partial<MarketVersion> = {}): MarketVersion {
  return {
    source: 'modrinth',
    id: 'v1',
    projectId: 'p1',
    name: 'Sodium 0.5.8',
    versionNumber: '0.5.8',
    releaseType: 'release',
    gameVersions: ['1.20.1'],
    loaders: ['fabric'],
    downloads: 1000,
    publishedAt: '2026-01-01T00:00:00Z',
    file: { url: 'https://x/a.jar', fileName: 'a.jar', size: 10 },
    dependencies: [],
    ...partial,
  }
}

function project(partial: Partial<MarketProject> = {}): MarketProject {
  return {
    source: 'modrinth',
    id: 'p1',
    slug: 'sodium',
    title: 'Sodium',
    description: 'Renderer',
    downloads: 1,
    categories: ['optimization'],
    gameVersions: ['1.20.1', '1.21.1'],
    loaders: ['fabric'],
    projectType: 'mod',
    updatedAt: '2026-01-01T00:00:00Z',
    ...partial,
  }
}

describe('loaderOptions', () => {
  it('offers loaders only for mods and modpacks', () => {
    expect(loaderOptions('mod').map((o) => o.key)).toEqual(['fabric', 'forge', 'neoforge', 'quilt'])
    expect(loaderOptions('resourcepack')).toHaveLength(0)
    expect(loaderOptions('shader')).toHaveLength(0)
    expect(loaderOptions('datapack')).toHaveLength(0)
  })
})

describe('marketLoaderOf', () => {
  it('maps launcher loader kinds to market names', () => {
    expect(marketLoaderOf('fabric')).toBe('fabric')
    expect(marketLoaderOf('quilt')).toBe('quilt')
    expect(marketLoaderOf('forge')).toBe('forge')
    expect(marketLoaderOf('neoforge')).toBe('neoforge')
    expect(marketLoaderOf('vanilla')).toBeUndefined()
    expect(marketLoaderOf('optifine')).toBeUndefined()
  })
})

describe('queryFromInstance', () => {
  it('inherits game version and the first real loader', () => {
    const query = queryFromInstance({ gameVersion: '1.20.1', loaders: [{ kind: 'vanilla' }, { kind: 'fabric' }] })
    expect(query.gameVersion).toBe('1.20.1')
    expect(query.loader).toBe('fabric')
  })

  it('keeps defaults without an instance', () => {
    expect(queryFromInstance(undefined)).toEqual(DEFAULT_MARKET_QUERY)
  })

  it('ignores loaders that the market does not know', () => {
    const query = queryFromInstance({ gameVersion: '1.16.5', loaders: [{ kind: 'optifine' }] })
    expect(query.gameVersion).toBe('1.16.5')
    expect(query.loader).toBe('')
  })
})

describe('toSearchInput', () => {
  it('converts the page index into an offset and drops empty filters', () => {
    const input = toSearchInput({ ...DEFAULT_MARKET_QUERY, query: '  sodium ', page: 2, pageSize: 20 })
    expect(input.query).toBe('sodium')
    expect(input.offset).toBe(40)
    expect(input.limit).toBe(20)
    expect(input.gameVersion).toBeUndefined()
    expect(input.loader).toBeUndefined()
  })

  it('clamps a negative page to zero', () => {
    expect(toSearchInput({ ...DEFAULT_MARKET_QUERY, page: -3 }).offset).toBe(0)
  })
})

describe('pageCount / clampPage', () => {
  it('always reports at least one page', () => {
    expect(pageCount(0, 20)).toBe(1)
    expect(pageCount(21, 20)).toBe(2)
    expect(pageCount(100, 20)).toBe(5)
    expect(pageCount(10, 0)).toBe(1)
  })

  it('clamps into range', () => {
    expect(clampPage(9, 45, 20)).toBe(2)
    expect(clampPage(-2, 45, 20)).toBe(0)
  })
})

describe('release helpers', () => {
  it('maps release types to tones and labels', () => {
    expect(releaseTone('release')).toBe('ok')
    expect(releaseTone('beta')).toBe('accent')
    expect(releaseTone('alpha')).toBe('warn')
    expect(releaseLabel('release')).toBe('正式版')
    expect(releaseLabel('alpha')).toBe('Alpha')
  })
})

describe('sortVersions', () => {
  it('orders newest first', () => {
    const older = version({ id: 'a', publishedAt: '2025-01-01T00:00:00Z' })
    const newer = version({ id: 'b', publishedAt: '2026-01-01T00:00:00Z' })
    expect(sortVersions([older, newer]).map((v) => v.id)).toEqual(['b', 'a'])
  })
})

describe('compatibleVersions', () => {
  const versions = [
    version({ id: 'fabric-1.20', loaders: ['fabric'], gameVersions: ['1.20.1'] }),
    version({ id: 'forge-1.20', loaders: ['forge'], gameVersions: ['1.20.1'] }),
    version({ id: 'any', loaders: [], gameVersions: [] }),
  ]

  it('filters by game version and loader', () => {
    expect(compatibleVersions(versions, { gameVersion: '1.20.1', loader: 'fabric' }).map((v) => v.id))
      .toEqual(['fabric-1.20', 'any'])
  })

  it('keeps versions that declare no constraints', () => {
    expect(compatibleVersions(versions, { gameVersion: '1.16.5', loader: 'quilt' }).map((v) => v.id))
      .toEqual(['any'])
  })

  it('is case-insensitive on loaders', () => {
    expect(compatibleVersions(versions, { loader: 'FABRIC' }).map((v) => v.id)).toEqual(['fabric-1.20', 'any'])
  })
})

describe('dependencies', () => {
  it('summarises required, optional and incompatible dependencies', () => {
    const v = version({
      dependencies: [
        { projectId: 'fabric-api', type: 'required' },
        { projectId: 'x', type: 'optional' },
        { projectId: 'y', type: 'incompatible' },
      ],
    })
    expect(summarizeDependencies(v)).toEqual({ required: 1, optional: 1, incompatible: 1, warn: true })
  })

  it('does not warn without hard requirements', () => {
    expect(summarizeDependencies(version({ dependencies: [{ projectId: 'x', type: 'optional' }] })).warn)
      .toBe(false)
    expect(summarizeDependencies(undefined).warn).toBe(false)
  })

  it('renders a Chinese sentence per case', () => {
    expect(depMsg(version({ dependencies: [{ projectId: 'a', type: 'required' }] })))
      .toContain('前置模组')
    expect(depMsg(version({ dependencies: [{ projectId: 'a', type: 'incompatible' }] })))
      .toContain('不兼容')
    expect(depMsg(version())).toBe('')
    expect(dependencyMessage(undefined)).toBe('')
  })
})

describe('targetSubdir', () => {
  it('maps project types to instance folders', () => {
    expect(targetSubdir('mod')).toBe('mods')
    expect(targetSubdir('resourcepack')).toBe('resourcepacks')
    expect(targetSubdir('shader')).toBe('shaderpacks')
    expect(targetSubdir('datapack')).toBe('datapacks')
    expect(targetSubdir('modpack')).toBe('mods')
  })
})

describe('curseforgeClassId', () => {
  it('maps types to CurseForge class ids', () => {
    expect(curseforgeClassId('mod')).toBe(6)
    expect(curseforgeClassId('modpack')).toBe(4471)
    expect(curseforgeClassId('resourcepack')).toBe(12)
    expect(curseforgeClassId('shader')).toBe(6552)
  })
})

describe('project helpers', () => {
  it('builds a stable cross-source key', () => {
    expect(projectKey(project())).toBe('modrinth:p1')
    expect(projectKey(project({ source: 'curseforge' }))).toBe('curseforge:p1')
  })

  it('renders a meta line from type, loaders and newest version', () => {
    expect(projectMetaLine(project())).toBe('mod · fabric · 1.21.1+')
    expect(projectMetaLine(project({ loaders: [], gameVersions: [] }))).toBe('mod')
  })

  it('matches loaders case-insensitively and keeps unknown ones', () => {
    expect(matchesLoader(project(), 'FABRIC')).toBe(true)
    expect(matchesLoader(project(), 'forge')).toBe(false)
    expect(matchesLoader(project({ loaders: [] }), 'forge')).toBe(true)
    expect(matchesLoader(project(), '')).toBe(true)
  })
})
