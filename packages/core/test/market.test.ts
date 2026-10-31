import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { crc32, deflateRawSync } from 'node:zlib'
import { installCore } from './support/implementation-fixtures.ts'
import { instancesPlugin } from './support/implementation-fixtures.ts'
import { PROJECT_DIRECTORIES } from '../src/services/market.ts'
import { marketPlugin } from './support/implementation-fixtures.ts'
import { modsPlugin } from './support/implementation-fixtures.ts'
import {
  CURSEFORGE_CLASS_IDS, CurseForgeClient, CurseForgeError, MINECRAFT_GAME_ID,
  curseForgeSortField, loaderNameOf, projectTypeFromClassId, toMarketProject as cfProject,
  toMarketVersion as cfVersion,
} from '../src/market/curseforge.ts'
import {
  MODRINTH_PROJECT_TYPES, ModrinthClient, ModrinthError, buildFacets, modrinthIndex,
  modrinthLoadersOf, projectTypeFromModrinth, toMarketProject, toMarketVersion,
} from '../src/market/modrinth.ts'
import type { RhContext } from '../src/contracts.ts'
import type { MarketVersion } from '../src/types.ts'

/* ------------------------------------------------------------------ */
/* fixtures                                                            */
/* ------------------------------------------------------------------ */

const SEARCH_PAYLOAD = {
  hits: [
    {
      project_id: 'AANobbMI', project_type: 'mod', slug: 'sodium', title: 'Sodium',
      description: 'A high-performance rendering engine', categories: ['fabric', 'optimization'],
      display_categories: ['fabric', 'optimization', 'quilt'], versions: ['1.20.1', '1.21'],
      downloads: 252857104, follows: 42086,
      icon_url: 'https://cdn.modrinth.com/data/AANobbMI/icon.png',
      date_modified: '2026-10-15T17:51:36.063140+00:00', author: 'jellysquid3',
    },
  ],
  offset: 0, limit: 20, total_hits: 1234,
}

const VERSION_PAYLOAD = [
  {
    id: 'OihdIimA', project_id: 'AANobbMI', name: 'Sodium 0.5.13 for Fabric',
    version_number: 'mc1.20.1-0.5.13-fabric', version_type: 'release', downloads: 12592173,
    game_versions: ['1.20.1'], loaders: ['fabric', 'quilt'],
    date_published: '2025-03-03T17:45:49.132919Z',
    files: [{
      primary: true, url: 'https://cdn.modrinth.com/data/AANobbMI/versions/OihdIimA/sodium.jar',
      filename: 'sodium-fabric-0.5.13+mc1.20.1.jar', size: 971552,
      hashes: { sha1: 'bcdbf37d9494e405cba210d7a80ed58e756297b5', sha512: 'aa' },
    }],
    dependencies: [{ project_id: 'P7dR8mSH', version_id: null, dependency_type: 'required' }],
  },
]

function makeZip(entries: { name: string; content: string | Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, eocd])
}

const MOD_JAR = makeZip([
  { name: 'fabric.mod.json', content: JSON.stringify({ id: 'sodium', version: '0.5.13', name: 'Sodium' }) },
])

/* ------------------------------------------------------------------ */
/* modrinth pure helpers                                               */
/* ------------------------------------------------------------------ */

describe('market/modrinth helpers', () => {
  it('maps sort options to indexes', () => {
    expect(modrinthIndex('downloads')).toBe('downloads')
    expect(modrinthIndex('newest')).toBe('newest')
    expect(modrinthIndex(undefined)).toBe('relevance')
  })

  it('builds facets as JSON arrays', () => {
    expect(buildFacets({ query: '' })).toBeUndefined()
    const facets = buildFacets({ query: '', projectType: 'mod', gameVersion: '1.20.1', loader: 'Fabric' })
    expect(JSON.parse(facets!)).toEqual([
      ['project_type:mod'],
      ['versions:1.20.1'],
      ['categories:fabric'],
    ])
    expect(MODRINTH_PROJECT_TYPES.shader).toBe('shader')
  })

  it('maps project types both ways', () => {
    expect(projectTypeFromModrinth('modpack')).toBe('modpack')
    expect(projectTypeFromModrinth('shader')).toBe('shader')
    expect(projectTypeFromModrinth(undefined)).toBe('mod')
  })

  it('extracts loader names from categories', () => {
    expect(modrinthLoadersOf({ categories: ['fabric', 'optimization', 'forge'] }))
      .toEqual(['fabric', 'forge'])
  })

  it('normalises a search hit', () => {
    const project = toMarketProject(SEARCH_PAYLOAD.hits[0])
    expect(project.source).toBe('modrinth')
    expect(project.id).toBe('AANobbMI')
    expect(project.slug).toBe('sodium')
    expect(project.downloads).toBe(252857104)
    expect(project.loaders).toContain('fabric')
    expect(project.gameVersions).toContain('1.20.1')
    expect(project.projectType).toBe('mod')
    expect(project.author).toBe('jellysquid3')
  })

  it('normalises a version payload', () => {
    const version = toMarketVersion(VERSION_PAYLOAD[0])
    expect(version.id).toBe('OihdIimA')
    expect(version.projectId).toBe('AANobbMI')
    expect(version.releaseType).toBe('release')
    expect(version.file.fileName).toBe('sodium-fabric-0.5.13+mc1.20.1.jar')
    expect(version.file.hashes?.sha1).toBe('bcdbf37d9494e405cba210d7a80ed58e756297b5')
    expect(version.dependencies[0]).toEqual({ projectId: 'P7dR8mSH', versionId: undefined, type: 'required' })
  })
})

/* ------------------------------------------------------------------ */
/* curseforge pure helpers                                             */
/* ------------------------------------------------------------------ */

describe('market/curseforge helpers', () => {
  it('maps sort fields and class ids', () => {
    expect(curseForgeSortField('downloads')).toBe(6)
    expect(curseForgeSortField(undefined)).toBe(1)
    expect(CURSEFORGE_CLASS_IDS.shader).toBe(6552)
    expect(projectTypeFromClassId(6552)).toBe('shader')
    expect(projectTypeFromClassId(6)).toBe('mod')
    expect(projectTypeFromClassId(99999)).toBe('mod')
  })

  it('maps loader enums', () => {
    expect(loaderNameOf(1)).toBe('forge')
    expect(loaderNameOf(4)).toBe('fabric')
    expect(loaderNameOf(6)).toBe('neoforge')
    expect(loaderNameOf(99)).toBeUndefined()
  })

  it('normalises a curseforge mod payload', () => {
    const project = cfProject({
      id: 238222, slug: 'jei', name: 'Just Enough Items', summary: 'JEI',
      classId: 6, downloadCount: 1000, thumbsUpCount: 20,
      logo: { thumbnailUrl: 'https://media.forgecdn.net/jei.png' },
      latestFilesIndexes: [{ gameVersion: '1.20.1', modLoader: 1 }, { gameVersion: '1.20.1', modLoader: 4 }],
      categories: [{ name: 'Map and Information' }],
      authors: [{ name: 'mezz' }],
      dateModified: '2024-01-01T00:00:00Z',
    })
    expect(project.source).toBe('curseforge')
    expect(project.id).toBe('238222')
    expect(project.iconUrl).toContain('jei.png')
    expect(project.loaders).toEqual(expect.arrayContaining(['forge', 'fabric']))
    expect(project.author).toBe('mezz')
  })

  it('normalises a curseforge file payload', () => {
    const version = cfVersion({
      id: 123, displayName: 'JEI 15.2.0', fileName: 'jei-1.20.1-15.2.0.jar', releaseType: 2,
      gameVersions: ['1.20.1', 'Forge'], fileLength: 100, downloadCount: 5,
      fileDate: '2024-01-01T00:00:00Z', downloadUrl: 'https://edge.forgecdn.net/files/jei.jar',
      hashes: [{ algo: 1, value: 'abc' }, { algo: 2, value: 'def' }],
      dependencies: [{ modId: 777, relationType: 2 }],
    }, '238222')
    expect(version.releaseType).toBe('beta')
    expect(version.file.hashes?.sha1).toBe('abc')
    expect(version.loaders).toEqual(['forge'])
    expect(version.dependencies[0].type).toBe('optional')
  })

  it('refuses to search without an api key', async () => {
    const client = new CurseForgeClient()
    expect(client.hasKey).toBe(false)
    await expect(client.search({ query: 'jei' })).rejects.toThrow(/API Key/)
  })
})

/* ------------------------------------------------------------------ */
/* clients against a local HTTP server                                 */
/* ------------------------------------------------------------------ */

describe('market clients over HTTP', () => {
  let server: Server
  let baseUrl = ''
  const requests: string[] = []

  beforeAll(async () => {
    server = createServer((request, response) => {
      requests.push(request.url ?? '')
      const url = request.url ?? ''
      response.setHeader('content-type', 'application/json')
      if (url.startsWith('/modrinth/v2/search')) {
        response.end(JSON.stringify(SEARCH_PAYLOAD))
        return
      }
      if (url.startsWith('/modrinth/v2/project/AANobbMI/version')) {
        response.end(JSON.stringify(VERSION_PAYLOAD))
        return
      }
      if (url.startsWith('/modrinth/v2/project/AANobbMI')) {
        response.end(JSON.stringify({ ...SEARCH_PAYLOAD.hits[0], id: 'AANobbMI', updated: '2026-10-15T00:00:00Z' }))
        return
      }
      if (url.startsWith('/curseforge/v1/mods/search')) {
        if (request.headers['x-api-key'] !== 'secret') {
          response.writeHead(403)
          response.end(JSON.stringify({ error: 'forbidden' }))
          return
        }
        response.end(JSON.stringify({
          data: [{ id: 1, name: 'CF Mod', slug: 'cf', summary: 'x', classId: 6, latestFilesIndexes: [], categories: [] }],
          pagination: { index: 0, pageSize: 20, resultCount: 1, totalCount: 1 },
        }))
        return
      }
      if (url.startsWith('/curseforge/v1/mods/1/files')) {
        response.end(JSON.stringify({ data: [{ id: 9, displayName: 'File', fileName: 'f.jar', gameVersions: ['Forge'], downloadUrl: 'https://x/f.jar', hashes: [] }] }))
        return
      }
      if (url.startsWith('/curseforge/v1/mods/1')) {
        response.end(JSON.stringify({ data: { id: 1, name: 'CF Mod', slug: 'cf', summary: 'x', classId: 6 } }))
        return
      }
      response.writeHead(404)
      response.end('{}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    baseUrl = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0)
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
  })

  it('searches modrinth and forwards the query', async () => {
    const client = new ModrinthClient({ baseUrl: baseUrl + '/modrinth' })
    const result = await client.search({ query: 'sodium', projectType: 'mod', gameVersion: '1.20.1', loader: 'fabric' })
    expect(result.total).toBe(1234)
    expect(result.hits[0].title).toBe('Sodium')
    const request = requests.find((url) => url.includes('/v2/search'))!
    expect(request).toContain('query=sodium')
    expect(decodeURIComponent(request)).toContain('project_type:mod')
  })

  it('loads a project and its versions', async () => {
    const client = new ModrinthClient({ baseUrl: baseUrl + '/modrinth' })
    const project = await client.project('AANobbMI')
    expect(project.slug).toBe('sodium')
    const versions = await client.versions('AANobbMI', { gameVersion: '1.20.1', loader: 'fabric' })
    expect(versions).toHaveLength(1)
    expect(versions[0].file.size).toBe(971552)
    const versionRequest = requests.find((url) => url.includes('/version?'))!
    expect(decodeURIComponent(versionRequest)).toContain('game_versions=["1.20.1"]')
  })

  it('maps HTTP failures to a Chinese error', async () => {
    const client = new ModrinthClient({ baseUrl: baseUrl + '/nope' })
    await expect(client.search({ query: 'x' })).rejects.toThrow(ModrinthError)
  })

  it('talks to curseforge with an api key', async () => {
    const client = new CurseForgeClient({ baseUrl: baseUrl + '/curseforge', apiKey: 'secret' })
    const result = await client.search({ query: 'jei', projectType: 'mod', gameVersion: '1.20.1', loader: 'forge' })
    expect(result.total).toBe(1)
    expect(result.hits[0].title).toBe('CF Mod')
    const request = decodeURIComponent(requests.find((url) => url.includes('/v1/mods/search'))!)
    expect(request).toContain('gameId=' + MINECRAFT_GAME_ID)
    expect(request).toContain('modLoaderType=1')

    const project = await client.project('1')
    expect(project.id).toBe('1')
    const versions = await client.versions('1', { loader: 'forge' })
    expect(versions[0].file.fileName).toBe('f.jar')
  })
})

/* ------------------------------------------------------------------ */
/* MarketService                                                       */
/* ------------------------------------------------------------------ */

describe('MarketService', () => {
  let root = ''
  let ctx: RhContext
  let server: Server
  let baseUrl = ''
  let jarRequests = 0

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'rhine-market-'))
    ctx = new Context() as unknown as RhContext
    await installCore(ctx as never, { root })
    await (ctx.plugin(instancesPlugin as never) as unknown as PromiseLike<unknown>)
    await (ctx.plugin(marketPlugin as never) as unknown as PromiseLike<unknown>)
    await (ctx.plugin(modsPlugin as never) as unknown as PromiseLike<unknown>)
    await ctx.paths.ensure()

    server = createServer((request, response) => {
      if (request.url === '/file/mod.jar') {
        jarRequests++
        response.writeHead(200, { 'content-type': 'application/java-archive' })
        response.end(MOD_JAR)
        return
      }
      response.setHeader('content-type', 'application/json')
      if (request.url?.startsWith('/v2/search')) {
        response.end(JSON.stringify(SEARCH_PAYLOAD))
        return
      }
      if (request.url?.startsWith('/v2/project/AANobbMI/version')) {
        response.end(JSON.stringify(VERSION_PAYLOAD))
        return
      }
      if (request.url?.startsWith('/v2/project/PACKID')) {
        response.end(JSON.stringify({
          ...SEARCH_PAYLOAD.hits[0], id: 'PACKID', project_type: 'resourcepack', slug: 'pack', title: 'A Pack',
        }))
        return
      }
      if (request.url?.startsWith('/v2/project/')) {
        response.end(JSON.stringify({ ...SEARCH_PAYLOAD.hits[0], id: 'AANobbMI', updated: '2026-10-15T00:00:00Z' }))
        return
      }
      response.writeHead(404)
      response.end('{}')
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    baseUrl = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0)
    await ctx.settings.update({ mirrors: { ...ctx.settings.resolved().mirrors, modrinth: baseUrl } })
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })

  it('searches through the configured mirror', async () => {
    const result = await ctx.market.search({ source: 'modrinth', query: 'sodium', projectType: 'mod' })
    expect(result.hits[0].title).toBe('Sodium')
    expect(result.offset).toBe(0)
  })

  it('fetches a project and its versions', async () => {
    const project = await ctx.market.project('modrinth', 'AANobbMI')
    expect(project.id).toBe('AANobbMI')
    const versions = await ctx.market.versions('modrinth', 'AANobbMI', { gameVersion: '1.20.1', loader: 'fabric' })
    expect(versions[0].versionNumber).toBe('mc1.20.1-0.5.13-fabric')
  })

  it('installs a mod into mods/', async () => {
    const instance = await ctx.instances.create({
      name: '市场测试', gameVersion: '1.20.1', loaders: [], memory: { minMb: 512, maxMb: 2048 },
      jvmArgs: [], gameArgs: [], window: { width: 800, height: 600, fullscreen: false },
    })
    const version = toMarketVersion(VERSION_PAYLOAD[0])
    version.file.url = baseUrl + '/file/mod.jar'
    version.file.hashes = { sha1: createHash('sha1').update(MOD_JAR).digest('hex') }
    version.file.size = MOD_JAR.length
    const installed = await ctx.market.install(instance.id, version)
    expect(installed.path.startsWith('mods/')).toBe(true)
    expect(installed.size).toBe(MOD_JAR.length)
    const mods = await ctx.mods.list(instance.id)
    expect(mods.map((mod) => mod.meta?.name)).toContain('Sodium')
    expect(jarRequests).toBe(1)
  })

  it('installs a resource pack into resourcepacks/', async () => {
    const instance = ctx.instances.list()[0]
    const version: MarketVersion = {
      ...toMarketVersion(VERSION_PAYLOAD[0]),
      projectId: 'PACKID',
      file: { url: baseUrl + '/file/mod.jar', fileName: 'pack.zip', size: MOD_JAR.length },
    }
    const installed = await ctx.market.install(instance.id, version)
    expect(installed.path).toBe('resourcepacks/pack.zip')
    const info = await stat(join(instance.path, 'resourcepacks', 'pack.zip'))
    expect(info.size).toBe(MOD_JAR.length)
  })

  it('rejects instead of installing to the wrong directory when project lookup fails', async () => {
    expect(PROJECT_DIRECTORIES.shader).toBe('shaderpacks')
    expect(PROJECT_DIRECTORIES.modpack).toBe('modpacks')
    const instance = ctx.instances.list()[0]
    const version: MarketVersion = {
      ...toMarketVersion(VERSION_PAYLOAD[0]),
      projectId: 'BROKEN',
      file: { url: baseUrl + '/file/mod.jar', fileName: 'x.jar', size: MOD_JAR.length },
    }
    const original = ctx.market.project.bind(ctx.market)
    ;(ctx.market as any).project = async () => { throw new Error('boom') }
    try {
      await expect(ctx.market.install(instance.id, version)).rejects.toThrow('boom')
      await expect(stat(join(instance.path,'mods','x.jar'))).rejects.toMatchObject({code:'ENOENT'})
    } finally {
      ;(ctx.market as any).project = original
    }
  })

  it('fails loudly when the published hash does not match', async () => {
    const instance = ctx.instances.list()[0]
    const version = toMarketVersion(VERSION_PAYLOAD[0])
    version.file.url = baseUrl + '/file/mod.jar'
    version.file.hashes = { sha1: '0000000000000000000000000000000000000000' }
    await expect(ctx.market.install(instance.id, version)).rejects.toThrow(/校验失败|下载失败/)
  })

  it('returns a Chinese hint when curseforge has no key', async () => {
    await expect(ctx.market.search({ source: 'curseforge', query: 'jei' })).rejects.toThrow(/API Key/)
    await expect(ctx.market.search({ source: 'curseforge', query: 'jei' })).rejects.toBeInstanceOf(CurseForgeError)
  })

  it('rejects installs for unknown instances', async () => {
    const version = toMarketVersion(VERSION_PAYLOAD[0])
    version.file.url = baseUrl + '/file/mod.jar'
    await expect(ctx.market.install('ghost', version)).rejects.toThrow(/实例不存在/)
  })

  it('rejects versions without a download url', async () => {
    const instance = ctx.instances.list()[0]
    const version = { ...toMarketVersion(VERSION_PAYLOAD[0]), file: { url: '', fileName: 'x.jar', size: 0 } }
    await expect(ctx.market.install(instance.id, version)).rejects.toThrow(/没有可下载的文件/)
  })

  it('falls back to the official download-url endpoint when downloadUrl is missing', async () => {
    const instance = ctx.instances.list()[0]
    await ctx.settings.update({ curseforgeApiKey: 'test-key' })
    const version: MarketVersion = {
      ...toMarketVersion(VERSION_PAYLOAD[0]),
      source: 'curseforge',
      projectId: '238222',
      id: '4593540',
      file: { url: '', fileName: 'jei.jar', size: 0, hashes: {} },
    }
    let asked: string | undefined
    const client = (ctx.market as any).curseforge() as CurseForgeClient
    client.downloadUrl = async (projectId: string, fileId: string) => {
      asked = projectId + '/' + fileId
      return baseUrl + '/file/mod.jar'
    }
    // projectTypeOf consults the same client; keep this test off the network.
    client.project = async () => ({ ...cfProject({ id: 238222, name: 'JEI', slug: 'jei' }), projectType: 'mod' as const })
    const installed = await ctx.market.install(instance.id, version)
    expect(asked).toBe('238222/4593540')
    expect(installed.size).toBe(MOD_JAR.length)
  })

  it('does not fabricate a CDN path when download-url also refuses', async () => {
    const instance = ctx.instances.list()[0]
    await ctx.settings.update({ curseforgeApiKey: 'test-key' })
    const version: MarketVersion = {
      ...toMarketVersion(VERSION_PAYLOAD[0]),
      source: 'curseforge', projectId: '238222', id: '4593540',
      file: { url: '', fileName: 'jei.jar', size: 0, hashes: {} },
    }
    const client = (ctx.market as any).curseforge() as CurseForgeClient
    client.downloadUrl = async () => { throw new CurseForgeError('作者禁止第三方下载') }
    await expect(ctx.market.install(instance.id, version)).rejects.toThrow(/没有可下载的文件/)
  })

  it('drops cached clients on reset', () => {
    const first = (ctx.market as any).modrinth()
    ;(ctx.market as any).reset()
    const second = (ctx.market as any).modrinth()
    expect(first).not.toBe(second)
  })
})

/* ------------------------------------------------------------------ */
/* real network smoke test                                             */
/* ------------------------------------------------------------------ */

// External connectivity is a separately requested smoke test, not a unit-test prerequisite.
describe.runIf(process.env.RHINE_LIVE_TESTS === '1')('modrinth live smoke', () => {
  it('searches the real Modrinth API for sodium', async () => {
    const client = new ModrinthClient()
    const result = await client.search({ query: 'sodium', limit: 3 })
    expect(result.hits.length).toBeGreaterThan(0)
    const sodium = result.hits.find((hit) => hit.slug === 'sodium') ?? result.hits[0]
    expect(sodium.title.length).toBeGreaterThan(0)
    expect(sodium.downloads).toBeGreaterThan(0)

    const versions = await client.versions(sodium.id, { gameVersion: '1.20.1', loader: 'fabric' })
    expect(versions.length).toBeGreaterThan(0)
    expect(versions[0].file.url).toMatch(/^https:\/\//)
    expect(versions[0].file.fileName).toMatch(/\.jar$/)
  }, 30000)
})

/* keep writeFile imported for future fixtures */
void writeFile
void readFile
