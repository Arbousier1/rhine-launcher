import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { crc32 } from 'node:zlib'
import type { FeatureEnvironment, TaskContext } from '@rhine/plugin-api'
import { createLauncherContext } from '../src/index.ts'
import type { Instance, TaskSnapshot } from '../src/types.ts'
import { discoverFeatures } from '../src/plugins/catalog.ts'
import { installInstanceFiles, manifestInventoryFile, validateManifestFiles, type CommittedFiles, type OriginalInstanceFile } from '../src/ellan/manifests.ts'
import type { ResourceMetadataCache, ResourceState } from '../src/ellan/resource-state.ts'
import { dispatchFeature } from '../../server/src/plugin-http.ts'
import { fixtureZip } from './support/zip-fixture.ts'

type Launcher = Awaited<ReturnType<typeof createLauncherContext>>
type Json = Record<string, any>
type OriginalEvent = { type: string; channel: string; args: any[] }
const rendererId = 'task27-local-fixture-renderer'
const backendKey = 'task27-fixture-backend-key'
let root: string, ctx: Launcher, server: Server, base: string, priorKey: string | undefined
let mrVersions: Map<string, Json>, mrProjects: Map<string, Json>, cfFiles: Map<number, Json>, cfProjects: Map<number, Json>, downloads: Map<string, Buffer>
let requests: { method: string; path: string; key?: string; body?: any }[]
let gates: Map<string, { entered: () => void; release: Promise<void>; finish: () => void }>
function digest(bytes: Buffer, algorithm = 'sha1'): string { return createHash(algorithm).update(bytes).digest('hex') }
function jar(id = 'fixture_mod', version = '1.0.0'): Buffer { return fixtureZip({ 'fabric.mod.json': JSON.stringify({ schemaVersion: 1, id, version, name: id, depends: { minecraft: '1.20.1', fabricloader: '>=0.15' } }) }) }
function blob(name: string, bytes: Buffer): string { const path = '/jars/' + encodeURIComponent(name); downloads.set(path, bytes); return base + path }
function mr(id = 'Version1', project = 'Project1', filename = 'main.jar', options: Json = {}): Json {
  const bytes = options.bytes ?? jar(project.toLowerCase(), id), url = blob(id + '-' + filename, bytes)
  mrProjects.set(project, { id: project, project_type: options.projectType ?? 'mod' })
  const value: Json = { id, project_id: project, game_versions: ['1.20.1'], loaders: ['fabric'], date_published: '2026-01-02T00:00:00Z', dependencies: [], files: [{ filename, url, hashes: { sha1: digest(bytes), sha512: digest(bytes, 'sha512') }, size: bytes.length, primary: true }], ...options }
  delete value.bytes; delete value.projectType
  mrVersions.set(id, value); return value
}
function cf(id = 10001, project = 101, filename = 'cf-main.jar', options: Json = {}): Json {
  const bytes = options.bytes ?? jar('cf_' + project, String(id)), url = blob(String(id) + '-' + filename, bytes)
  cfProjects.set(project, { id: project, classId: options.classId ?? 6 })
  const value: Json = { id, modId: project, fileName: filename, fileLength: bytes.length, downloadUrl: url, hashes: [{ algo: 1, value: digest(bytes) }, { algo: 2, value: digest(bytes, 'md5') }], gameVersions: ['1.20.1', 'Fabric'], fileDate: '2026-01-02T00:00:00Z', dependencies: [], ...options }
  delete value.bytes; delete value.classId
  cfFiles.set(id, value); return value
}
async function original<T = unknown>(id: string, args: unknown[]): Promise<T> { return (await ctx.features.call<Promise<{ result: T }>>(id, { rendererId, args })).result }
async function instance(name = 'Task 27 isolated fixture', loaders: Instance['loaders'] = [{ kind: 'fabric', version: '0.15.0' }]): Promise<Instance> { return ctx.features.call<Promise<Instance>>('instance.create', { name, gameVersion: '1.20.1', loaders }) }
async function resolved(inst: Instance, version = 'Version1'): Promise<OriginalInstanceFile[]> { return original('ellan.market.mods.resolve', [{ instancePath: inst.path, market: 0, version: { versionId: version } }]) }
async function install(inst: Instance, files: OriginalInstanceFile[], oldFiles: OriginalInstanceFile[] = []): Promise<void> { await original('ellan.manifest.install', [{ path: inst.path, oldFiles, files }]) }
async function cache(): Promise<ResourceMetadataCache> { return JSON.parse(await readFile(join(root, '.rhine', 'ellan-resource-metadata.json'), 'utf8')) }
async function inventory(inst: Instance): Promise<CommittedFiles> { return JSON.parse(await readFile(manifestInventoryFile(inst.path), 'utf8')) }
async function stagedNames(inst: Instance): Promise<string[]> { return (await readdir(join(inst.path, '.rhine')).catch(() => [])).filter(name => name.startsWith('ellan-install-')) }
function pause(url: string): { entered: Promise<void>; finish: () => void } {
  let entered!: () => void, finish!: () => void
  const enteredPromise = new Promise<void>(r => { entered = r }), release = new Promise<void>(r => { finish = r })
  gates.set(new URL(url).pathname, { entered, release, finish }); return { entered: enteredPromise, finish }
}
function directEnvironment(controller: AbortController, cancelAfterWrite?: number): FeatureEnvironment {
  const data = new Map<string, unknown>()
  const task: TaskContext = { id: 'task27-direct-cancel-fixture', get cancelled() { return controller.signal.aborted }, throwIfCancelled() { controller.signal.throwIfAborted() }, log() {}, setProgress(p) { if (p.stage === 'write' && p.current === cancelAfterWrite) controller.abort(new Error('fixture commit cancellation')) } }
  return { context: ctx, signal: controller.signal, task,
    use<T>(id: string, input?: unknown): T { return ctx.features.call<T>(id, input, { signal: controller.signal, task }) },
    state<T>(key: string, init: () => T): T { if (!data.has(key)) data.set(key, init()); return data.get(key) as T }, onDispose() {},
  }
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'rhine-task27-market-'))
  mrVersions = new Map(); mrProjects = new Map(); cfFiles = new Map(); cfProjects = new Map(); downloads = new Map(); requests = []; gates = new Map()
  priorKey = process.env.RHINE_CURSEFORGE_API_KEY; process.env.RHINE_CURSEFORGE_API_KEY = backendKey
  server = createServer((req, res) => { void (async () => {
    const url = new URL(req.url!, base), path = url.pathname
    let body: any
    if (req.method === 'POST') { const chunks: Buffer[] = []; for await (const chunk of req) chunks.push(Buffer.from(chunk)); body = JSON.parse(Buffer.concat(chunks).toString('utf8')) }
    requests.push({ method: req.method!, path: url.pathname + url.search, key: req.headers['x-api-key'] as string | undefined, body })
    const gate = gates.get(path); if (gate) { gate.entered(); await gate.release }
    if (downloads.has(path)) { const bytes = downloads.get(path)!; res.writeHead(200, { 'content-type': 'application/java-archive', 'content-length': bytes.length }); res.end(bytes); return }
    let payload: any
    let match = /^\/modrinth\/v2\/version\/([^/]+)$/.exec(path)
    if (match) payload = mrVersions.get(decodeURIComponent(match[1]))
    match = /^\/modrinth\/v2\/project\/([^/]+)$/.exec(path)
    if (match) payload = mrProjects.get(decodeURIComponent(match[1]))
    match = /^\/modrinth\/v2\/project\/([^/]+)\/version$/.exec(path)
    if (match) payload = [...mrVersions.values()].filter(v => v.project_id === decodeURIComponent(match![1])) // Deliberately retain incompatible rows: resolver must also check them.
    if (path === '/curseforge/v1/mods/files' && body) payload = { data: body.fileIds.flatMap((id: number) => cfFiles.has(id) ? [cfFiles.get(id)] : []) }
    match = /^\/curseforge\/v1\/mods\/([0-9]+)$/.exec(path)
    if (match && cfProjects.has(Number(match[1]))) payload = { data: cfProjects.get(Number(match[1])) }
    match = /^\/curseforge\/v1\/mods\/([0-9]+)\/files$/.exec(path)
    if (match) { const rows = [...cfFiles.values()].filter(v => v.modId === Number(match![1])); const index = Number(url.searchParams.get('index') ?? 0); payload = { data: rows.slice(index, index + 50), pagination: { totalCount: rows.length } } }
    match = /^\/curseforge\/v1\/mods\/([0-9]+)\/files\/([0-9]+)\/download-url$/.exec(path)
    if (match && cfFiles.has(Number(match[2]))) payload = { data: cfFiles.get(Number(match[2]))!.resolvedUrl ?? null }
    if (payload === undefined) { res.writeHead(404, { 'content-type': 'application/json' }); res.end('{"error":"fixture-not-found"}'); return }
    res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify(payload))
  })().catch(error => { res.writeHead(500); res.end(String(error)) }) })
  await new Promise<void>(r => server.listen(0, '127.0.0.1', r))
  base = 'http://127.0.0.1:' + (server.address() as { port: number }).port
  ctx = await createLauncherContext({ root })
  await ctx.features.call('settings.update', { mirrors: { modrinth: base + '/modrinth', curseforge: base + '/curseforge' }, curseforgeApiKey: 'ignored-fixture-setting' })
})
afterEach(async () => {
  for (const gate of gates?.values() ?? []) gate.finish()
  await ctx?.features.dispose()
  if (server) { server.closeAllConnections(); await new Promise<void>((r, reject) => server.close(error => error ? reject(error) : r())) }
  if (priorKey === undefined) delete process.env.RHINE_CURSEFORGE_API_KEY; else process.env.RHINE_CURSEFORGE_API_KEY = priorKey
  if (root) { if (!root.startsWith(join(tmpdir(), 'rhine-task27-market-'))) throw new Error('Unexpected isolated cleanup root'); await rm(root, { recursive: true, force: true }) }
})

describe('original market manifests, with tiny localhost provider JSON and jars', () => {
  it('resolves the exact requested secondary filename and real required dependencies with game/loader filters, without downloading', async () => {
    const inst = await instance(), primary = mr(), extra = jar('actual_secondary'), beforeLayout = await readdir(inst.path)
    primary.files.push({ filename: 'secondary.jar', url: blob('secondary.jar', extra), hashes: { sha1: digest(extra), sha512: digest(extra, 'sha512') }, size: extra.length, primary: false })
    primary.dependencies = [{ project_id: 'Project2', version_id: null, dependency_type: 'required' }, { project_id: 'Project3', version_id: null, dependency_type: 'optional' }, { project_id: null, version_id: 'Unknown1', dependency_type: 'embedded' }]
    mr('Version2', 'Project2', 'dependency.jar', { date_published: '2026-01-03T00:00:00Z', dependencies: [{ project_id: 'Project1', version_id: 'Version1', dependency_type: 'required' }] })
    mr('Version3', 'Project2', 'wrong-game.jar', { game_versions: ['1.21.1'], date_published: '2026-02-01T00:00:00Z' })
    mr('Version4', 'Project2', 'wrong-loader.jar', { loaders: ['forge'], date_published: '2026-03-01T00:00:00Z' })
    const files = await original<OriginalInstanceFile[]>('ellan.market.mods.resolve', [{ market: 0, instancePath: inst.path, version: { versionId: 'Version1', filename: 'secondary.jar' } }])
    expect(files.map(f => f.path)).toEqual(['mods/secondary.jar', 'mods/dependency.jar'])
    expect(files[0]).toEqual({ path: 'mods/secondary.jar', hashes: { sha1: digest(extra), sha512: digest(extra, 'sha512') }, downloads: [base + '/jars/secondary.jar'], size: extra.length, modrinth: { projectId: 'Project1', versionId: 'Version1' } })
    expect(files[1].modrinth).toEqual({ projectId: 'Project2', versionId: 'Version2' })
    const list = new URL(requests.find(r => r.path.startsWith('/modrinth/v2/project/Project2/version'))!.path, base)
    expect(JSON.parse(list.searchParams.get('game_versions')!)).toEqual(['1.20.1']); expect(JSON.parse(list.searchParams.get('loaders')!)).toEqual(['fabric'])
    expect(requests.some(r => /Project3|Unknown1/.test(r.path))).toBe(false)
    expect(requests.filter(r => r.path.startsWith('/jars/'))).toEqual([])
    expect(await readdir(inst.path)).toEqual(beforeLayout); expect(await readdir(join(inst.path, 'mods'))).toEqual([])
  })

  it('uses actual CurseForge file lookup and required relationType=3, keeping secrets backend-only', async () => {
    const inst = await instance(), main = cf(10001, 101)
    main.dependencies = [{ modId: 102, relationType: 3 }, { modId: 103, relationType: 2 }, { modId: 104, relationType: 1 }, { modId: 105, relationType: 5 }]
    cf(10002, 102, 'cf-dependency.jar'); cf(10003, 102, 'wrong-forge.jar', { gameVersions: ['1.20.1', 'Forge'], fileDate: '2026-03-01T00:00:00Z' })
    const files = await original<OriginalInstanceFile[]>('ellan.market.mods.resolve', [{ instancePath: inst.path, market: 1, file: [{ fileId: 10001 }] }])
    expect(files.map(f => f.curseforge)).toEqual([{ projectId: 101, fileId: 10001 }, { projectId: 102, fileId: 10002 }])
    expect(requests.find(r => r.path === '/curseforge/v1/mods/files')?.body).toEqual({ fileIds: [10001] })
    const list = new URL(requests.find(r => r.path.startsWith('/curseforge/v1/mods/102/files?'))!.path, base)
    expect(list.searchParams.get('gameVersion')).toBe('1.20.1'); expect(list.searchParams.get('modLoaderType')).toBe('4')
    expect(requests.filter(r => r.path.startsWith('/curseforge/')).every(r => r.key === backendKey)).toBe(true)
    expect(JSON.stringify(files)).not.toContain(backendKey); expect(requests.some(r => /mods\/(103|104|105)/.test(r.path))).toBe(false)
    await install(inst, files)
    const watched = await original<ResourceState>('ellan.mods.watch', [inst.path])
    expect(watched.files.map(f => f.metadata.curseforge)).toEqual([{ projectId: 102, fileId: 10002 }, { projectId: 101, fileId: 10001 }])
    expect(JSON.stringify(await cache())).not.toContain(backendKey)
  })

  it('never invents IDs or silently substitutes a missing/incompatible requested version or filename', async () => {
    const inst = await instance(); mr()
    await expect(resolved(inst, 'Unknown1')).rejects.toMatchObject({ code: 'MARKET_VERSION_NOT_FOUND' })
    await expect(original('ellan.market.mods.resolve', [{ instancePath: inst.path, market: 0, version: { versionId: 'slug-not-an-id' } }])).rejects.toThrow()
    await expect(original('ellan.market.mods.resolve', [{ instancePath: inst.path, market: 0, version: { versionId: 'Version1', filename: 'absent.jar' } }])).rejects.toMatchObject({ code: 'MARKET_FILE_NOT_FOUND' })
    mrVersions.get('Version1')!.loaders = ['forge']
    await expect(resolved(inst)).rejects.toMatchObject({ code: 'MARKET_INCOMPATIBLE' })
    mrVersions.get('Version1')!.id = 'Version2'
    await expect(resolved(inst)).rejects.toMatchObject({ code: 'INVALID_MARKET_MANIFEST' })
    expect(requests.filter(r => r.path.startsWith('/jars/'))).toEqual([])
  })

  it('pins explicit required versions and rejects incompatible/conflicting dependency plans', async () => {
    const inst = await instance(), main = mr()
    main.dependencies = [{ project_id: 'Project2', version_id: 'Version2', dependency_type: 'required' }]
    mr('Version2', 'Project2', 'pin.jar'); mr('Version3', 'Project2', 'newer.jar', { date_published: '2026-03-01T00:00:00Z' })
    expect((await resolved(inst))[1].modrinth?.versionId).toBe('Version2')
    await expect(original('ellan.market.mods.resolve', [{ instancePath: inst.path, market: 0, version: [{ versionId: 'Version1' }, { versionId: 'Version3' }] }])).rejects.toMatchObject({ code: 'MARKET_VERSION_CONFLICT' })
    main.dependencies.push({ project_id: 'Project2', version_id: null, dependency_type: 'incompatible' })
    await expect(resolved(inst)).rejects.toMatchObject({ code: 'MARKET_DEPENDENCY_CONFLICT' })
  })

  it('resolves real resource/shader domain paths without falsely requiring a mod loader', async () => {
    const inst = await instance('Vanilla resource fixture', [])
    mr('Version1', 'Project1', 'resources.zip', { projectType: 'resourcepack', loaders: ['minecraft'], bytes: fixtureZip({ 'pack.mcmeta': '{"pack":{"pack_format":15,"description":"fixture"}}' }) })
    mr('Version2', 'Project2', 'shader.zip', { projectType: 'shader', loaders: ['iris'], bytes: fixtureZip({ 'shaders/shaders.properties': 'fixture=true' }) })
    for (const [folder, id] of [['resourcepacks', 'Version1'], ['shaderpacks', 'Version2']]) {
      const files = await original<OriginalInstanceFile[]>('ellan.market.' + folder + '.resolve', [{ instancePath: inst.path, market: 0, version: { versionId: id } }])
      expect(files[0].path.startsWith(folder + '/')).toBe(true)
      expect(await original<string[]>('ellan.market.' + folder + '.install', [{ instancePath: inst.path, market: 0, version: { versionId: id } }])).toEqual([join(inst.path, ...files[0].path.split('/'))])
    }
    await expect(resolved(inst)).rejects.toMatchObject({ code: 'MARKET_RESOURCE_DOMAIN' })
  })

  it('uses an actual download-url response when provided, and refuses an opted-out file instead of a fabricated CDN URL', async () => {
    const inst = await instance(), file = cf(10001, 101, 'download-url.jar')
    file.resolvedUrl = file.downloadUrl; file.downloadUrl = null
    const files = await original<OriginalInstanceFile[]>('ellan.market.mods.resolve', [{ instancePath: inst.path, market: 1, file: { fileId: 10001 } }])
    expect(files[0].downloads).toEqual([file.resolvedUrl])
    file.resolvedUrl = null
    await expect(original('ellan.market.mods.resolve', [{ instancePath: inst.path, market: 1, file: { fileId: 10001 } }])).rejects.toMatchObject({ code: 'MARKET_DOWNLOAD_UNAVAILABLE' })
  })
})

describe('original transactional installInstanceFiles', () => {
  it('downloads/validates into staging, publishes actual Resources and persists true original manifests/refs', async () => {
    const inst = await instance(), main = mr(); mr('Version2', 'Project2', 'dependency.jar')
    main.dependencies = [{ project_id: 'Project2', version_id: 'Version2', dependency_type: 'required' }]
    const state = await original<ResourceState & { id: string }>('ellan.mods.watch', [inst.path]), events: OriginalEvent[] = []
    const off = ctx.features.call<() => void>('events.subscribe', (event: OriginalEvent) => events.push(event))
    try {
      const files = await resolved(inst); expect(await install(inst, files)).toBeUndefined()
      for (const file of files) { const bytes = await readFile(join(inst.path, ...file.path.split('/'))); expect(digest(bytes)).toBe(file.hashes.sha1) }
      const committed = await inventory(inst)
      expect(committed.version).toBe(1); expect(committed.files).toHaveLength(2)
      for (const file of committed.files) { expect(file.hashes.sha1).toMatch(/^[a-f0-9]{40}$/); expect(file.hashes.sha256).toMatch(/^[a-f0-9]{64}$/); expect(file.modrinth?.projectId).toMatch(/^Project[12]$/); expect(file).not.toHaveProperty('name') }
      const saved = await cache(); expect(saved[files[0].hashes.sha1].metadata?.modrinth).toEqual(files[0].modrinth)
      const update = events.filter(e => e.type === 'ellan' && e.channel === 'commit' && e.args[0] === state.id && e.args[1] === 'filesUpdates').at(-1)!
      expect(update.args[2]).toHaveLength(2); expect(update.args[2].every(([f, action]: [Json, number]) => action === 0 && f.path.startsWith(inst.path) && f.metadata.modrinth)).toBe(true)
      const before = await stat(join(inst.path, 'mods', 'main.jar')), downloadCount = requests.filter(r => r.path.startsWith('/jars/')).length
      await install(inst, files)
      expect((await stat(join(inst.path, 'mods', 'main.jar'))).mtimeMs).toBe(before.mtimeMs)
      expect(requests.filter(r => r.path.startsWith('/jars/'))).toHaveLength(downloadCount)
      expect(await stagedNames(inst)).toEqual([])
    } finally { off() }
  })

  it('applies real oldFiles removals and replacements while retaining unaffected installed inventory', async () => {
    const inst = await instance(); mr(); mr('Version2', 'Project2', 'retained.jar')
    const old = await resolved(inst), retained = await resolved(inst, 'Version2'); await install(inst, [...old, ...retained])
    mr('Version3', 'Project1', 'new-main.jar')
    const replacement = await resolved(inst, 'Version3'), configBytes = Buffer.from('enabled=true\n'), config = { path: 'config/fixture/settings.cfg', hashes: { sha256: digest(configBytes, 'sha256') }, size: configBytes.length, downloads: [blob('settings.cfg', configBytes)] }
    await install(inst, [...replacement, config], old)
    await expect(readFile(join(inst.path, 'mods', 'main.jar'))).rejects.toMatchObject({ code: 'ENOENT' })
    expect(await readFile(join(inst.path, 'config', 'fixture', 'settings.cfg'))).toEqual(configBytes)
    expect((await inventory(inst)).files.map(f => f.path)).toEqual(['config/fixture/settings.cfg', 'mods/new-main.jar', 'mods/retained.jar'])
  })

  it.each(['checksum', 'size', 'download'])('does not touch live files/metadata when a later staged %s fixture fails', async failure => {
    const inst = await instance(); mr(); const old = await resolved(inst); await install(inst, old)
    const beforeBytes = await readFile(join(inst.path, 'mods', 'main.jar')), beforeCache = await readFile(join(root, '.rhine', 'ellan-resource-metadata.json')), beforeInventory = await readFile(manifestInventoryFile(inst.path))
    const good = jar('good_new'), bad = jar('bad_new'), files: OriginalInstanceFile[] = [
      { path: 'mods/good.jar', downloads: [blob('good.jar', good)], hashes: { sha1: digest(good) }, size: good.length },
      { path: 'mods/bad.jar', downloads: [failure === 'download' ? base + '/jars/absent.jar' : blob('bad.jar', bad)], hashes: { sha1: failure === 'checksum' ? '0'.repeat(40) : digest(bad) }, size: failure === 'size' ? bad.length + 1 : bad.length },
    ]
    await expect(install(inst, files, old)).rejects.toThrow()
    expect(await readFile(join(inst.path, 'mods', 'main.jar'))).toEqual(beforeBytes)
    expect(await readdir(join(inst.path, 'mods'))).toEqual(['main.jar'])
    expect(await readFile(join(root, '.rhine', 'ellan-resource-metadata.json'))).toEqual(beforeCache)
    expect(await readFile(manifestInventoryFile(inst.path))).toEqual(beforeInventory); expect(await stagedNames(inst)).toEqual([])
  })

  it.each([1, 3])('rolls back file and metadata renames if cancellation happens after commit step %s', async step => {
    const inst = await instance(); mr(); const old = await resolved(inst); await install(inst, old)
    const beforeBytes = await readFile(join(inst.path, 'mods', 'main.jar')), beforeCache = await readFile(join(root, '.rhine', 'ellan-resource-metadata.json')), beforeInventory = await readFile(manifestInventoryFile(inst.path))
    mr('Version2', 'Project1', 'main.jar'); const next = await resolved(inst, 'Version2'), controller = new AbortController()
    await expect(installInstanceFiles({ rendererId, args: [{ path: inst.path, oldFiles: old, files: next }] }, directEnvironment(controller, step))).rejects.toThrow('fixture commit cancellation')
    expect(await readFile(join(inst.path, 'mods', 'main.jar'))).toEqual(beforeBytes)
    expect(await readFile(join(root, '.rhine', 'ellan-resource-metadata.json'))).toEqual(beforeCache)
    expect(await readFile(manifestInventoryFile(inst.path))).toEqual(beforeInventory); expect(await stagedNames(inst)).toEqual([])
  })

  it('rejects an unrelated syntactically-valid provider ref instead of persisting fake metadata', async () => {
    const inst = await instance(); mr(); mr('Version2', 'Project2', 'other.jar')
    const files = await resolved(inst)
    files[0].modrinth = { projectId: 'Project2', versionId: 'Version2' }
    await expect(install(inst, files)).rejects.toMatchObject({ code: 'MARKET_SOURCE_MISMATCH' })
    expect(await readdir(join(inst.path, 'mods')).catch(() => [])).toEqual([])
    await expect(readFile(join(root, '.rhine', 'ellan-resource-metadata.json'))).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('rejects traversal, Windows aliases, metadata writes and intra/cross-manifest collisions before download', async () => {
    const inst = await instance(), bytes = jar(), file: OriginalInstanceFile = { path: 'mods/safe.jar', hashes: { sha1: digest(bytes) }, downloads: [blob('safe.jar', bytes)], size: bytes.length }
    for (const path of ['../escape.jar', 'mods/../escape.jar', 'mods\\escape.jar', '/escape.jar', 'C:/escape.jar', 'mods/NUL.jar', 'mods/x.jar:stream', 'mods/%2e%2e.jar', 'mods/trailing.jar.', '.rhine/ellan-resource-metadata.json', 'instance.json', '.install/file.jar', 'instance-lock.json', 'unresolved-files.json', 'mod-groups.json']) await expect(install(inst, [{ ...file, path }])).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
    for (const files of [[file, file], [file, { ...file, path: 'mods/SAFE.jar' }], [{ ...file, path: 'config/value' }, { ...file, path: 'config/value/child.cfg' }]]) await expect(install(inst, files)).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    await expect(install(inst, [{ ...file, path: 'mods/SAFE.jar' }], [file])).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    await expect(original('ellan.manifest.install', [{ path: inst.id, oldFiles: [], files: [file] }])).rejects.toMatchObject({ code: 'NATIVE_PATH_REQUIRED' })
    await expect(original('ellan.manifest.install', [{ path: join(root, 'unregistered'), oldFiles: [], files: [file] }])).rejects.toMatchObject({ code: 'INSTANCE_NOT_FOUND' })
    expect(requests.filter(r => r.path.startsWith('/jars/'))).toEqual([])
    expect(() => validateManifestFiles([{ ...file, hashes: {} }])).toThrow()
    await expect(original('ellan.manifest.install', [{ path: inst.path, upstream: { type: 'peer' }, files: [file] }])).rejects.toMatchObject({ code: 'UNSUPPORTED_INSTANCE_UPSTREAM' })
  })

  it('refuses stale oldFiles and unowned existing/case-alias target collisions', async () => {
    const inst = await instance(), bytes = jar('unowned'), url = blob('new.jar', jar('new'))
    await mkdir(join(inst.path, 'mods'), { recursive: true }); await writeFile(join(inst.path, 'mods', 'existing.jar'), bytes)
    const file: OriginalInstanceFile = { path: 'mods/existing.jar', hashes: { sha1: digest(jar('new')) }, downloads: [url] }
    await expect(install(inst, [file])).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    await expect(install(inst, [file], [{ ...file, downloads: [] }])).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    await expect(install(inst, [{ ...file, path: 'mods/Existing.jar' }])).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    expect(await readFile(join(inst.path, 'mods', 'existing.jar'))).toEqual(bytes)
  })

  it('rejects a directory junction/symlink and symlinked registered root without touching fixture targets', async () => {
    const inst = await instance(), bytes = jar(), external = join(root, 'fixture-external')
    await mkdir(external); expect(await readdir(join(inst.path, 'mods'))).toEqual([]); await rmdir(join(inst.path, 'mods')); await symlink(external, join(inst.path, 'mods'), process.platform === 'win32' ? 'junction' : 'dir')
    const file = { path: 'mods/linked.jar', hashes: { sha1: digest(bytes) }, downloads: [blob('linked.jar', bytes)] }
    await expect(install(inst, [file])).rejects.toMatchObject({ code: 'UNSAFE_PATH' }); expect(await readdir(external)).toEqual([])
    const another = await instance('Root link fixture'), actual = another.path + '-actual', beforeLayout = await readdir(another.path)
    await rename(another.path, actual); await symlink(actual, another.path, process.platform === 'win32' ? 'junction' : 'dir')
    await expect(install(another, [file])).rejects.toThrow()
    expect(await readdir(actual)).toEqual(beforeLayout)
  })

  it('verifies original local file URLs, MD5 and decimal CRC32 rather than accepting unchecked sources', async () => {
    const inst = await instance(), bytes = Buffer.from('tiny original local file\n'), source = join(root, 'selected.txt')
    await writeFile(source, bytes)
    await install(inst, [{ path: 'config/local.txt', hashes: { md5: digest(bytes, 'md5') }, downloads: [pathToFileURL(source).href] }, { path: 'config/crc.txt', hashes: { crc32: String(crc32(bytes) >>> 0) }, downloads: [blob('crc.txt', bytes)] }])
    expect(await readFile(join(inst.path, 'config', 'local.txt'))).toEqual(bytes)
    expect(await readFile(source)).toEqual(bytes)
    await expect(install(inst, [{ path: 'config/bad-crc.txt', hashes: { crc32: '0' }, downloads: [blob('crc.txt', bytes)] }])).rejects.toMatchObject({ code: 'CHECKSUM_MISMATCH' })
    await expect(install(inst, [{ path: 'config/no-url.txt', hashes: { sha1: digest(bytes) } }])).rejects.toMatchObject({ code: 'UNRESOLVED_INSTANCE_FILE' })
  })

  it('does not clobber live files changed during a paused staging download', async () => {
    const inst = await instance(); mr(); const old = await resolved(inst); await install(inst, old)
    mr('Version2', 'Project1', 'main.jar'); const next = await resolved(inst, 'Version2'), gate = pause(next[0].downloads![0])
    const installing = install(inst, next, old), rejected = expect(installing).rejects.toMatchObject({ code: 'FILE_CHANGED' })
    await gate.entered; const changed = jar('external_edit'); await writeFile(join(inst.path, 'mods', 'main.jar'), changed); gate.finish()
    await rejected; expect(await readFile(join(inst.path, 'mods', 'main.jar'))).toEqual(changed); expect(await stagedNames(inst)).toEqual([])
  })

  it('serializes overlapping plans and merges actual provider metadata across independent roots', async () => {
    const a = await instance('Independent A'), b = await instance('Independent B'); mr(); mr('Version2', 'Project2', 'second.jar')
    const filesA = await resolved(a), filesB = await resolved(b, 'Version2')
    await Promise.all([install(a, filesA), install(b, filesB)])
    const saved = await cache(); expect(saved[filesA[0].hashes.sha1].metadata?.modrinth).toEqual(filesA[0].modrinth); expect(saved[filesB[0].hashes.sha1].metadata?.modrinth).toEqual(filesB[0].modrinth)
    mr('Version3', 'Project1', 'main.jar'); const conflict = await resolved(a, 'Version3')
    const results = await Promise.allSettled([install(a, filesA), install(a, conflict)])
    expect(results.map(r => r.status)).toEqual(['fulfilled', 'rejected'])
    expect(digest(await readFile(join(a.path, 'mods', 'main.jar')))).toBe(filesA[0].hashes.sha1)
  })

  it('waits for an owned original RPC task and returns the original installFromMarket result, not a fake task envelope', async () => {
    const inst = await instance(); mr()
    const gate = pause(mrVersions.get('Version1')!.files[0].url), events: OriginalEvent[] = []
    const off = ctx.features.call<() => void>('events.subscribe', (event: OriginalEvent) => events.push(event))
    let waiting: Promise<Response> | undefined
    try {
      waiting = dispatchFeature(ctx.features, new Request(base + '/api/ellan/services/InstanceModsService/installFromMarket', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rendererId, args: [{ instancePath: inst.path, market: 0, version: { versionId: 'Version1' } }] }) }))
      await gate.entered
      const task = ctx.features.call<TaskSnapshot[]>('task.list').find(t => t.kind === 'market-install')!
      expect(task.status).toBe('running'); expect(task.progress.stage).toBe('download')
      const activate = events.find(e => e.type === 'ellan' && e.channel === 'task-activated')!
      expect(activate.args).toEqual([true]) // Original activation wire shape is a boolean, not a renderer ID.
      await expect(readFile(join(inst.path, 'mods', 'main.jar'))).rejects.toMatchObject({ code: 'ENOENT' })
      gate.finish(); const response = await waiting
      expect(response.status).toBe(200); expect(await response.json()).toEqual({ result: [join(inst.path, 'mods', 'main.jar')] })
      expect(ctx.features.call<TaskSnapshot[]>('task.list').filter(t => t.kind === 'market-install')).toHaveLength(1)
      expect(ctx.features.call<TaskSnapshot>('task.get', { id: task.id }).status).toBe('succeeded')
    } finally { gate.finish(); await waiting?.catch(() => {}); off() }
  })

  it('keeps the backend-owned installation running when only the original HTTP waiter disconnects', async () => {
    const inst = await instance(); mr()
    const gate = pause(mrVersions.get('Version1')!.files[0].url), caller = new AbortController()
    const waiting = dispatchFeature(ctx.features, new Request(base + '/api/ellan/services/InstanceModsService/installFromMarket', { method: 'POST', signal: caller.signal, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rendererId, args: [{ instancePath: inst.path, market: 0, version: { versionId: 'Version1' } }] }) }))
    const rejected = expect(waiting).rejects.toMatchObject({ code: 'PLUGIN_CANCELLED' })
    let task: TaskSnapshot | undefined
    try {
      await gate.entered; task = ctx.features.call<TaskSnapshot[]>('task.list').find(t => t.kind === 'market-install')!
      caller.abort(); await rejected
      expect(ctx.features.call<TaskSnapshot>('task.get', { id: task.id }).status).toBe('running')
      gate.finish()
      expect((await ctx.features.call<Promise<TaskSnapshot>>('task.wait', { id: task.id })).status).toBe('succeeded')
      expect(digest(await readFile(join(inst.path, 'mods', 'main.jar')))).toBe(mrVersions.get('Version1')!.files[0].hashes.sha1)
    } finally { gate.finish(); await waiting.catch(() => {}); if (task) await ctx.features.call('task.wait', { id: task.id }) }
  })

  it('preserves the original void installInstanceFiles RPC instead of returning a pretend pending/resume task API', async () => {
    const inst = await instance(); mr(); const files = await resolved(inst)
    const response = await dispatchFeature(ctx.features, new Request(base + '/api/ellan/services/InstanceInstallService/installInstanceFiles', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rendererId, args: [{ path: inst.path, oldFiles: [], files }] }) }))
    expect(response.status).toBe(200); expect(await response.json()).toEqual({}) // JSON omits the genuine undefined result.
    expect(ctx.features.call<TaskSnapshot[]>('task.list').filter(t => t.kind === 'instance-install').map(t => t.status)).toEqual(['succeeded'])
    expect((await inventory(inst)).files[0].modrinth).toEqual(files[0].modrinth)
  })

  it('discovers exactly one descriptor per real original method with explicit dependencies and no fake pending/resume RPC', async () => {
    const descriptors = (await discoverFeatures()).filter(e => /^ellan\.(market\.|manifest\.)/.test(e.plugin.id)).map(e => e.plugin)
    expect(descriptors).toHaveLength(7)
    for (const plugin of descriptors) { expect(plugin.capability).toBe(plugin.id); expect(plugin.http?.method).toBe('POST'); expect(plugin.depends?.length).toBeGreaterThan(0); if (plugin.id.endsWith('.install')) expect(plugin.http?.background?.waitForResult).toBe(true) }
    expect(descriptors.map(d => d.http?.path).sort()).toEqual(['InstanceModsService', 'InstanceResourcePacksService', 'InstanceShaderPacksService'].flatMap(service => ['resolveFromMarket', 'installFromMarket'].map(method => '/api/ellan/services/' + service + '/' + method)).concat('/api/ellan/services/InstanceInstallService/installInstanceFiles').sort())
    expect(descriptors.some(d => /pending|resume|stageInstanceFiles|getInstanceInstallManifest/.test(d.id + d.http?.path))).toBe(false)
  })
})
