import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createServer, type Server } from 'node:http'
import { mkdtemp, readFile, readdir, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { installCore } from './support/implementation-fixtures.ts'
import { instancesPlugin } from './support/implementation-fixtures.ts'
import { isModFile, sanitizeFileName, stripDisabled, withEnabled } from '../src/services/mods.ts'
import { modsPlugin } from './support/implementation-fixtures.ts'
import { readModDescriptor, looksLikeJar, mimeOf, parseForgeToml, parseJsonDescriptor, parseManifest, parseMcmodInfo } from '../src/mods/descriptor.ts'
import { parseToml, tomlGet, tomlString, parseKeyPath } from '../src/mods/toml.ts'
import { ZipArchive, ZipError, findEndOfCentralDirectory, readZipEntries } from '../src/mods/zip.ts'
import type { RhContext } from '../src/contracts.ts'

/* ------------------------------------------------------------------ */
/* a tiny but real ZIP writer (deflate) used to build fixture jars     */
/* ------------------------------------------------------------------ */

interface FixtureEntry { name: string; content: string | Buffer }

/** Build a real ZIP archive in memory (local headers + central directory). */
function makeZip(entries: FixtureEntry[]): Buffer {
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
    local.writeUInt16LE(0, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt16LE(0, 10)
    local.writeUInt16LE(0, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28)
    locals.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
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

const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)

/* ------------------------------------------------------------------ */
/* zip reader                                                          */
/* ------------------------------------------------------------------ */

describe('mods/zip', () => {
  it('parses a real deflate archive', () => {
    const buffer = makeZip([
      { name: 'a.txt', content: 'hello' },
      { name: 'dir/', content: '' },
      { name: 'dir/b.json', content: JSON.stringify({ ok: true }) },
    ])
    const entries = readZipEntries(buffer)
    expect(entries.map((entry) => entry.name)).toEqual(['a.txt', 'dir/', 'dir/b.json'])
    expect(entries[0].method).toBe(8)
    expect(entries[0].uncompressedSize).toBe(5)
    expect(entries[1].isDirectory).toBe(true)
    expect(findEndOfCentralDirectory(buffer)).toBeGreaterThan(0)
  })

  it('rejects files that are not archives', () => {
    expect(() => readZipEntries(new Uint8Array([1, 2, 3]))).toThrow(ZipError)
    expect(() => readZipEntries(Buffer.alloc(64))).toThrow(/ZIP/)
  })

  it('normalises separators and strips leading slashes', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-zip-'))
    try {
      const file = join(dir, 'a.jar')
      await writeFile(file, makeZip([{ name: '/evil/../x.txt', content: 'x' }]))
      const archive = await ZipArchive.open(file)
      expect(archive.entries[0].name).toBe('evil/../x.txt')
      expect(await archive.readText('x.txt')).toBeUndefined()
      await archive.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('reads entries from disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-zip-'))
    try {
      const file = join(dir, 'a.jar')
      await writeFile(file, makeZip([
        { name: 'manifest.mf', content: 'Manifest-Version: 1.0' },
        { name: 'assets/logo.png', content: PNG_1PX },
      ]))
      const archive = await ZipArchive.open(file)
      expect(await archive.readText('MANIFEST.MF')).toBe('Manifest-Version: 1.0')
      const png = await archive.read('assets/logo.png')
      expect(png?.length).toBe(PNG_1PX.length)
      expect(await archive.readText('missing.txt')).toBeUndefined()
      await archive.close()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/* ------------------------------------------------------------------ */
/* toml                                                                */
/* ------------------------------------------------------------------ */

describe('mods/toml', () => {
  it('parses tables, arrays of tables and dotted keys', () => {
    const table = parseToml([
      'modLoader="javafml"',
      'loaderVersion="[47,)"',
      'license="MIT"',
      '',
      '[[mods]]',
      'modId="example"',
      'version="1.0.0"',
      'displayName="Example Mod"',
      'authors="a, b"',
      'description=\'\'\'multi',
      'line\'\'\'',
      '',
      '[[dependencies.example]]',
      'modId="minecraft"',
      'mandatory=true',
      'versionRange="[1.20,)"',
      '',
      '[[dependencies.example]]',
      'modId="forge"',
      'mandatory=false',
      'versionRange="[47,)"',
    ].join('\n'))
    expect(table.modLoader).toBe('javafml')
    expect(tomlGet(table, 'mods.modId')).toBeUndefined()
    const mods = table.mods as any[]
    expect(mods).toHaveLength(1)
    expect(mods[0].displayName).toBe('Example Mod')
    expect(mods[0].description).toBe('multi\nline')
    // `[[dependencies.example]]` becomes a table keyed by mod id.
    const dependencies = tomlGet(table, 'dependencies.example') as any[]
    expect(Array.isArray(dependencies)).toBe(true)
    expect(dependencies[1].modId).toBe('forge')
  })

  it('handles comments and inline tables', () => {
    const table = parseToml([
      '# leading comment',
      'name = "a # b" # trailing',
      'inline = { x = 1, y = "two" }',
      'list = ["a", "b", "c"]',
      'flag = true',
      'count = 42',
    ].join('\n'))
    expect(table.name).toBe('a # b')
    expect((table.inline as any).x).toBe(1)
    expect(table.list).toEqual(['a', 'b', 'c'])
    expect(table.flag).toBe(true)
    expect(table.count).toBe(42)
  })

  it('splits quoted key paths', () => {
    expect(parseKeyPath('a.b.c')).toEqual(['a', 'b', 'c'])
    expect(parseKeyPath('"a.b".c')).toEqual(['a.b', 'c'])
  })

  it('coerces values to strings', () => {
    expect(tomlString(1)).toBe('1')
    expect(tomlString(true)).toBe('true')
    expect(tomlString(['a', 'b'])).toBe('a, b')
    expect(tomlString(undefined)).toBeUndefined()
  })
})

/* ------------------------------------------------------------------ */
/* descriptors                                                         */
/* ------------------------------------------------------------------ */

describe('mods/descriptor', () => {
  it('parses fabric.mod.json including the icon as a data URL', () => {
    const meta = parseJsonDescriptor(JSON.stringify({
      id: 'sodium', version: '0.5.13', name: 'Sodium',
      description: 'Fast renderer', authors: ['jellysquid3'],
      icon: 'assets/icon.png',
      depends: { minecraft: '>=1.20', fabricloader: '>=0.14', 'fabric-api': '*' },
    }), 'fabric.mod.json', 'fabric')
    expect(meta?.id).toBe('sodium')
    expect(meta?.name).toBe('Sodium')
    expect(meta?.authors).toEqual(['jellysquid3'])
    expect(meta?.dependencies?.map((dependency) => dependency.id)).toEqual(['fabric-api'])
    expect(meta?.loader).toBe('fabric')
  })

  it('parses quilt.mod.json wrapped payloads', () => {
    const meta = parseJsonDescriptor(JSON.stringify({
      schema_version: 1,
      quilt_loader: {
        id: 'qmod',
        version: '2.0.0',
        metadata: { name: 'Quilt Mod', description: 'quilt', icon: 'icon.png' },
        depends: [{ id: 'quilt_loader', versions: '>=0.20' }, { id: 'qsl', versions: '*' }],
      },
    }), 'quilt.mod.json', 'quilt')
    expect(meta?.id).toBe('qmod')
    expect(meta?.name).toBe('Quilt Mod')
    expect(meta?.loader).toBe('quilt')
    expect(meta?.dependencies?.map((dependency) => dependency.id)).toContain('qsl')
  })

  it('parses forge mods.toml', () => {
    const meta = parseForgeToml([
      'modLoader="javafml"',
      'loaderVersion="[47,)"',
      'license="MIT"',
      '[[mods]]',
      'modId="jei"',
      'version="15.2.0.27"',
      'displayName="Just Enough Items"',
      'logoFile="logo.png"',
      'authors="mezz"',
      '[[dependencies.jei]]',
      'modId="minecraft"',
      'mandatory=true',
      'versionRange="[1.20.1,1.21)"',
      '[[dependencies.jei]]',
      'modId="cloth-config"',
      'mandatory=false',
      'versionRange="*"',
    ].join('\n'), 'forge')
    expect(meta?.id).toBe('jei')
    expect(meta?.name).toBe('Just Enough Items')
    expect(meta?.authors).toEqual(['mezz'])
    expect(meta?.icon).toBe('logo.png')
    expect(meta?.loader).toBe('forge')
    const optional = meta?.dependencies?.find((dependency) => dependency.id === 'cloth-config')
    expect(optional?.optional).toBe(true)
    // minecraft itself is filtered out
    expect(meta?.dependencies?.some((dependency) => dependency.id === 'minecraft')).toBe(false)
  })

  it('parses legacy mcmod.info', () => {
    const meta = parseMcmodInfo(JSON.stringify([{
      modid: 'oldmod', name: 'Old Mod', version: '1.0', authorList: ['someone'], description: 'legacy',
    }]))
    expect(meta?.id).toBe('oldmod')
    expect(meta?.authors).toEqual(['someone'])
    expect(parseMcmodInfo('{ bad json')).toBeUndefined()
  })

  it('parses MANIFEST.MF as a fallback', () => {
    const meta = parseManifest('Manifest-Version: 1.0\r\nImplementation-Title: SomeLib\r\nImplementation-Version: 2.1\r\n')
    expect(meta?.name).toBe('SomeLib')
    expect(meta?.version).toBe('2.1')
    expect(parseManifest('Manifest-Version: 1.0')).toBeUndefined()
  })

  it('detects jar-like file names', () => {
    expect(looksLikeJar('a.jar')).toBe(true)
    expect(looksLikeJar('a.jar.disabled')).toBe(true)
    expect(looksLikeJar('a.litemod')).toBe(true)
    expect(looksLikeJar('notes.txt')).toBe(false)
  })

  it('guesses icon mime types', () => {
    expect(mimeOf('x.png')).toBe('image/png')
    expect(mimeOf('x.JPEG')).toBe('image/jpeg')
    expect(mimeOf('x.exe')).toBeUndefined()
  })

  it('reads descriptors from real jars on disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-jar-'))
    try {
      const fabric = join(dir, 'fabric.jar')
      await writeFile(fabric, makeZip([
        { name: 'fabric.mod.json', content: JSON.stringify({ id: 'fixture', version: '1.0', name: 'Fixture', icon: 'icon.png' }) },
        { name: 'icon.png', content: PNG_1PX },
      ]))
      const meta = await readModDescriptor(fabric)
      expect(meta?.name).toBe('Fixture')
      expect(meta?.icon?.startsWith('data:image/png;base64,')).toBe(true)

      const forge = join(dir, 'forge.jar')
      await writeFile(forge, makeZip([
        { name: 'META-INF/mods.toml', content: '[[mods]]\nmodId="fmod"\nversion="2.0"\ndisplayName="Forge Fixture"\n' },
      ]))
      expect((await readModDescriptor(forge))?.name).toBe('Forge Fixture')

      const neoforge = join(dir, 'neoforge.jar')
      await writeFile(neoforge, makeZip([
        { name: 'META-INF/neoforge.mods.toml', content: '[[mods]]\nmodId="nmod"\nversion="3.0"\ndisplayName="Neo Fixture"\n' },
      ]))
      expect((await readModDescriptor(neoforge))?.loader).toBe('neoforge')

      const manifestOnly = join(dir, 'lib.jar')
      await writeFile(manifestOnly, makeZip([
        { name: 'META-INF/MANIFEST.MF', content: 'Implementation-Title: Lib Thing\r\nImplementation-Version: 9\r\n' },
      ]))
      expect((await readModDescriptor(manifestOnly))?.name).toBe('Lib Thing')

      const broken = join(dir, 'broken.jar')
      await writeFile(broken, 'not a zip at all')
      expect((await readModDescriptor(broken))?.name).toBe('broken')

      expect(await readModDescriptor(join(dir, 'missing.jar'))).toBeUndefined()
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})

/* ------------------------------------------------------------------ */
/* file name helpers                                                   */
/* ------------------------------------------------------------------ */

describe('mods file names', () => {
  it('toggles the .disabled suffix', () => {
    expect(stripDisabled('a.jar.disabled')).toBe('a.jar')
    expect(stripDisabled('a.jar')).toBe('a.jar')
    expect(withEnabled('a.jar', false)).toBe('a.jar.disabled')
    expect(withEnabled('a.jar.disabled', true)).toBe('a.jar')
    expect(withEnabled('a.jar.disabled', false)).toBe('a.jar.disabled')
  })

  it('recognises mod archives', () => {
    expect(isModFile('a.jar')).toBe(true)
    expect(isModFile('a.jar.disabled')).toBe(true)
    expect(isModFile('a.txt')).toBe(false)
  })

  it('sanitises download names', () => {
    expect(sanitizeFileName('a/b.jar')).toBe('b.jar')
    expect(sanitizeFileName('..\\evil.jar')).toBe('evil.jar')
    expect(sanitizeFileName('bad:name?.jar')).toBe('bad_name_.jar')
    expect(sanitizeFileName('')).toBe('download.jar')
    expect(sanitizeFileName('CON')).toBe('_CON')
    expect(sanitizeFileName('a'.repeat(400) + '.jar').length).toBeLessThanOrEqual(180)
  })
})

/* ------------------------------------------------------------------ */
/* ModService                                                          */
/* ------------------------------------------------------------------ */

describe('ModService', () => {
  let root = ''
  let ctx: RhContext
  let server: Server
  let serverUrl = ''
  const jarBytes = makeZip([
    { name: 'fabric.mod.json', content: JSON.stringify({ id: 'netmod', version: '1.0', name: 'Net Mod' }) },
  ])

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'rhine-mods-'))
    ctx = new Context() as unknown as RhContext
    await installCore(ctx as never, { root })
    await (ctx.plugin(instancesPlugin as never) as unknown as PromiseLike<unknown>)
    await (ctx.plugin(modsPlugin as never) as unknown as PromiseLike<unknown>)
    await ctx.paths.ensure()

    server = createServer((request, response) => {
      if (request.url?.endsWith('.jar')) {
        response.writeHead(200, { 'content-type': 'application/java-archive' })
        response.end(jarBytes)
        return
      }
      response.writeHead(404)
      response.end()
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    serverUrl = 'http://127.0.0.1:' + (typeof address === 'object' && address ? address.port : 0)
  })

  afterAll(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    await rm(root, { recursive: true, force: true })
  })

  it('lists mods with parsed metadata and enabled state', async () => {
    const instance = await ctx.instances.create({
      name: '模组测试', gameVersion: '1.20.1', loaders: [], memory: { minMb: 512, maxMb: 2048 },
      jvmArgs: [], gameArgs: [], window: { width: 800, height: 600, fullscreen: false },
    })
    const modsDir = join(instance.path, 'mods')
    await writeFile(join(modsDir, 'alpha.jar'), makeZip([
      { name: 'fabric.mod.json', content: JSON.stringify({ id: 'alpha', version: '1.0', name: 'Alpha' }) },
    ]))
    await writeFile(join(modsDir, 'beta.jar.disabled'), makeZip([
      { name: 'fabric.mod.json', content: JSON.stringify({ id: 'beta', version: '2.0', name: 'Beta' }) },
    ]))
    await writeFile(join(modsDir, 'notes.txt'), 'ignore me')
    await mkdir(join(modsDir, 'subdir'), { recursive: true })

    const mods = await ctx.mods.list(instance.id)
    expect(mods).toHaveLength(2)
    const alpha = mods.find((mod) => mod.name === 'alpha.jar')
    expect(alpha?.enabled).toBe(true)
    expect(alpha?.meta?.name).toBe('Alpha')
    expect(alpha?.diskName).toBe('alpha.jar')
    const beta = mods.find((mod) => mod.name === 'beta.jar')
    expect(beta?.enabled).toBe(false)
    expect(beta?.diskName).toBe('beta.jar.disabled')
    expect(beta?.meta?.version).toBe('2.0')
  })

  it('enables and disables a mod by renaming', async () => {
    const instance = ctx.instances.list()[0]
    const disabled = await ctx.mods.setEnabled(instance.id, 'alpha.jar', false)
    expect(disabled.enabled).toBe(false)
    expect(disabled.diskName).toBe('alpha.jar.disabled')
    const names = await readdir(join(instance.path, 'mods'))
    expect(names).toContain('alpha.jar.disabled')
    expect(names).not.toContain('alpha.jar')

    const enabled = await ctx.mods.setEnabled(instance.id, 'alpha.jar.disabled', true)
    expect(enabled.enabled).toBe(true)
    expect(enabled.diskName).toBe('alpha.jar')
  })

  it('removes a mod', async () => {
    const instance = ctx.instances.list()[0]
    await ctx.mods.remove(instance.id, 'beta.jar.disabled')
    const names = await readdir(join(instance.path, 'mods'))
    expect(names).not.toContain('beta.jar.disabled')
    await expect(ctx.mods.remove(instance.id, 'nope.jar')).rejects.toThrow(/不存在/)
  })

  it('installs a mod from a real HTTP url', async () => {
    const instance = ctx.instances.list()[0]
    const installed = await ctx.mods.install(instance.id, serverUrl + '/netmod.jar', 'net-mod.jar')
    expect(installed.enabled).toBe(true)
    expect(installed.meta?.name).toBe('Net Mod')
    const bytes = await readFile(join(instance.path, 'mods', 'net-mod.jar'))
    expect(bytes.length).toBe(jarBytes.length)
  })

  it('inspects a jar without installing it', async () => {
    const instance = ctx.instances.list()[0]
    const meta = await ctx.mods.inspect(join(instance.path, 'mods', 'net-mod.jar'))
    expect(meta?.id).toBe('netmod')
    expect(await ctx.mods.inspect(join(instance.path, 'mods', 'missing.jar'))).toBeUndefined()
  })

  it('reports a helpful error for an unknown instance', async () => {
    await expect(ctx.mods.list('nope')).rejects.toThrow(/实例不存在/)
    await expect(ctx.mods.setEnabled('nope', 'a.jar', true)).rejects.toThrow(/实例不存在/)
  })
})
