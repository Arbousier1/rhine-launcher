import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { createLauncherContext } from '../src/index.ts'
import type { Instance } from '../src/types.ts'
import { discoverFeatures } from '../src/plugins/catalog.ts'
import { showModsDirectory } from '../src/ellan/mod-operations.ts'
import type { ResourceFile, ResourceState } from '../src/ellan/resource-state.ts'
import { fixtureZip } from './support/zip-fixture.ts'

type Launcher = Awaited<ReturnType<typeof createLauncherContext>>
type Watched = ResourceState & { id: string; __state__: string }
type OriginalEvent = { type: string; channel: string; args: unknown[] }
const rendererId = 'task25-fixture-renderer'
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=', 'base64')
const fabric = { schemaVersion: 1, id: 'actual_fabric', version: '1.2.3', name: 'Actual Fabric Mod', description: 'From the descriptor', authors: ['Alice', { name: 'Bob' }], depends: { minecraft: '~1.20', fabricloader: '>=0.15', support_lib: '*' }, provides: ['actual_alias'], environment: '*', license: 'MIT', icon: { '16': 'assets/icon.png' } }
function forgeToml(id: string, version: string): string {
  return ['modLoader="javafml"', 'loaderVersion="[47,)"', 'license="MIT"', 'issueTrackerURL="https://example.invalid/issues"',
    '[[mods]]', 'modId="' + id + '"', 'version="' + version + '"', 'displayName="Actual ' + id + '"', 'description="Declared description"', 'authors="Alice, Bob"', 'logoFile="assets/icon.png"',
    '[[dependencies.' + id + ']]', 'modId="minecraft"', 'mandatory=true', 'versionRange="[1.20,1.21)"', 'ordering="NONE"', 'side="BOTH"',
    '[[dependencies.' + id + ']]', 'modId="support_lib"', 'mandatory=false', 'versionRange="[2,)"', 'ordering="AFTER"', 'side="CLIENT"'].join('\n')
}
function simpleJar(mod = fabric): Buffer { return fixtureZip({ 'fabric.mod.json': JSON.stringify(mod), 'assets/icon.png': png }) }
let root: string, ctx: Launcher
async function original<T>(id: string, args: unknown[]): Promise<T> {
  return (await ctx.features.call<{ result: T }>(id, { rendererId, args })).result
}
async function instance(name = 'Task-25 fixture'): Promise<Instance> { return await ctx.features.call<Instance>('instance.create', { name, gameVersion: '1.20.1' }) }
async function jar(inst: Instance, name: string, bytes: Buffer): Promise<string> {
  await mkdir(join(inst.path, 'mods'), { recursive: true })
  const path = join(inst.path, 'mods', name)
  await writeFile(path, bytes)
  return path
}
function commits(events: OriginalEvent[], method: string): OriginalEvent[] { return events.filter(event => event.type === 'ellan' && event.channel === 'commit' && event.args[1] === method) }

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'rhine-task25-mods-')); ctx = await createLauncherContext({ root }) })
afterEach(async () => {
  await ctx?.features.dispose()
  if (root) {
    if (!root.startsWith(join(tmpdir(), 'rhine-task25-mods-'))) throw new Error('Unexpected fixture cleanup path')
    await rm(root, { recursive: true, force: true })
  }
})

describe('original InstanceModsService resource and operation capabilities', () => {
  it('projects real native fields and all original loader metadata from a hybrid jar', async () => {
    const inst = await instance()
    const quilt = { schema_version: 1, quilt_loader: { group: 'fixture', id: 'actual_quilt', version: '4.5.6', depends: [{ id: 'quilt_loader', versions: '>=0.23' }], metadata: { name: 'Actual Quilt', description: 'Quilt descriptor', contributors: { Alice: 'Author' }, license: 'MIT', icon: 'assets/icon.png', contact: { sources: 'https://example.invalid/source' } } } }
    const bytes = fixtureZip({
      'fabric.mod.json': JSON.stringify(fabric), 'quilt.mod.json': JSON.stringify(quilt),
      'META-INF/mods.toml': forgeToml('actual_forge', '$' + '{file.jarVersion}'),
      'META-INF/neoforge.mods.toml': forgeToml('actual_neo', '3.0.0') + '\n[[mods]]\nmodId="actual_neo_child"\nversion="3.0.1"\ndisplayName="Actual child"',
      'META-INF/MANIFEST.MF': 'Manifest-Version: 1.0\r\nImplementation-Version: 9.0.1\r\n\r\n', 'assets/icon.png': png,
    })
    const path = await jar(inst, 'hybrid.jar.disabled', bytes)
    await writeFile(join(inst.path, 'mods', 'settings.toml'), 'not an archive')
    await writeFile(join(inst.path, 'mods', 'ignored.jar.pending'), bytes)
    const state = await original<Watched>('ellan.mods.watch', [inst.path])
    expect(state.__state__).toBe('ResourceState')
    expect(state.errors).toEqual([])
    expect(state.files).toHaveLength(1)
    const file = state.files[0], info = await stat(path)
    expect(file).toMatchObject({ version: 3, path, fileName: 'hybrid.jar.disabled', hash: createHash('sha1').update(bytes).digest('hex'), size: bytes.length, mtime: info.mtimeMs, ctime: info.ctimeMs, ino: info.ino, isDirectory: false })
    expect(file.name).toBe('hybrid.jar.disabled')
    expect(file.atime).toBeTypeOf('number')
    expect(file.metadata.fabric).toEqual(fabric)
    expect(file.metadata.quilt).toEqual(quilt)
    expect(file.metadata.forge).toMatchObject({ modid: 'actual_forge', name: 'Actual actual_forge', version: '9.0.1', authors: ['Alice, Bob'], acceptMinecraft: '[1.20,1.21)', mcmodInfo: [], modAnnotations: [] })
    expect(file.metadata.forge?.modsToml[0].dependencies).toEqual([
      { modId: 'minecraft', mandatory: true, versionRange: '[1.20,1.21)', ordering: 'NONE', side: 'BOTH' },
      { modId: 'support_lib', mandatory: false, versionRange: '[2,)', ordering: 'AFTER', side: 'CLIENT' },
    ])
    expect(file.metadata.neoforge).toMatchObject({ modid: 'actual_neo', version: '3.0.0', children: [{ modid: 'actual_neo_child', version: '3.0.1', dependencies: [] }] })
    expect(file.icons).toContain('data:image/png;base64,' + png.toString('base64'))
    expect(file.metadata.modrinth).toBeUndefined()
    expect(file.metadata.curseforge).toBeUndefined()
    expect((await original<Watched>('ellan.mods.watch', [inst.path])).id).toBe(state.id)
  })

  it('expands only actual nested Fabric jars and keeps descriptorless jars without fake metadata', async () => {
    const inst = await instance()
    const nested = { schemaVersion: 1, id: 'actual_nested', version: '0.1.0', provides: ['nested_alias'], depends: { actual_fabric: '*' } }
    const rootFabric = { ...fabric, jars: [{ file: 'META-INF/jars/nested.jar' }, { file: 'META-INF/jars/non-fabric.jar' }] }
    await jar(inst, 'nested.jar', fixtureZip({ 'fabric.mod.json': JSON.stringify(rootFabric), 'META-INF/jars/nested.jar': simpleJar(nested as typeof fabric), 'META-INF/jars/non-fabric.jar': fixtureZip({ 'readme.txt': 'No mod descriptor' }), 'assets/icon.png': png }))
    await jar(inst, 'plain.jar', fixtureZip({ 'readme.txt': 'A real ZIP, but no declared loader metadata' }))
    await jar(inst, 'malformed-descriptor.jar', fixtureZip({ 'fabric.mod.json': '{invalid JSON', 'META-INF/mods.toml': forgeToml('actual_surviving_forge', '1.0.0'), 'assets/icon.png': png }))
    await jar(inst, 'legacy.jar', fixtureZip({ 'mcmod.info': JSON.stringify([{ modid: 'actual_legacy', name: 'Actual Legacy', version: '1.0', mcversion: '1.12.2', authorList: ['Alice'], logoFile: 'assets/icon.png' }]), 'assets/icon.png': png }))
    const state = await original<Watched>('ellan.mods.watch', [inst.path])
    expect(state.errors).toEqual([])
    expect(state.files.find(file => file.fileName === 'nested.jar')?.metadata.fabric).toEqual([rootFabric, nested])
    expect(state.files.find(file => file.fileName === 'plain.jar')?.metadata).toEqual({})
    const surviving = state.files.find(file => file.fileName === 'malformed-descriptor.jar')!
    expect(surviving.metadata.fabric).toBeUndefined()
    expect(surviving.metadata.forge?.modid).toBe('actual_surviving_forge')
    expect(state.files.find(file => file.fileName === 'legacy.jar')?.metadata.forge).toMatchObject({ modid: 'actual_legacy', name: 'Actual Legacy', acceptMinecraft: '[1.12.2]', authors: ['Alice'], modsToml: [], modAnnotations: [] })
  })

  it('surfaces corrupt files and publishes fresh filesUpdates on every metadata refresh', async () => {
    const inst = await instance(), path = await jar(inst, 'broken.jar', Buffer.from('This is not a ZIP'))
    const state = await original<Watched>('ellan.mods.watch', [inst.path])
    expect(state.files).toEqual([])
    expect(state.errors).toEqual([{ path, code: 'InvalidZipFileError' }])
    const events: OriginalEvent[] = []
    const off = ctx.features.call<() => void>('events.subscribe', (event: OriginalEvent) => events.push(event))
    try {
      await original('ellan.mods.refresh-metadata', [inst.path])
      const empty = commits(events, 'filesUpdates').at(-1)!
      expect(empty.args).toEqual([state.id, 'filesUpdates', []])
      await original('ellan.mods.refresh-metadata', [inst.path])
      const sameEmpty = commits(events, 'filesUpdates').at(-1)!
      expect(sameEmpty.args).toEqual(empty.args)
      expect(sameEmpty.args[2]).not.toBe(empty.args[2])
      await writeFile(path, simpleJar())
      await original('ellan.mods.refresh-metadata', [inst.path])
      expect(commits(events, 'errorsUpdates').at(-1)?.args).toEqual([state.id, 'errorsUpdates', [[path, 1]]])
      const first = commits(events, 'filesUpdates').at(-1)!
      await original('ellan.mods.refresh-metadata', [inst.path])
      const second = commits(events, 'filesUpdates').at(-1)!
      // Reading a native file legitimately advances atime on some filesystems.
      const withoutAccessTime = (event: OriginalEvent) => (event.args[2] as [ResourceFile, 0][]).map(([file, action]) => { const { atime: _atime, ...stable } = file; return [stable, action] })
      expect(withoutAccessTime(second)).toEqual(withoutAccessTime(first))
      expect(second.args[2]).not.toBe(first.args[2])
      expect((second.args[2] as [ResourceFile, 0][])[0]).toMatchObject([{ path, metadata: { fabric } }, 0])
      expect((await original<Watched>('ellan.mods.watch', [inst.path])).errors).toEqual([])
    } finally { off() }
  })

  it('imports actual local jars and delegates enable, disable and uninstall without changing source bytes', async () => {
    const inst = await instance(), source = join(root, 'selected.jar'), bytes = simpleJar()
    await writeFile(source, bytes)
    const installed = await original<string[]>('ellan.mods.install', [{ path: inst.path, files: [source] }])
    const target = join(inst.path, 'mods', 'selected.jar')
    expect(installed).toEqual([target])
    const initial = await original<Watched>('ellan.mods.watch', [inst.path])
    await original('ellan.mods.disable', [{ path: inst.path, files: [target] }])
    expect(await readdir(join(inst.path, 'mods'))).toEqual(['selected.jar.disabled'])
    const disabled = await original<Watched>('ellan.mods.watch', [inst.path])
    expect(disabled.id).toBe(initial.id)
    expect(disabled.files[0].path).toBe(target + '.disabled')
    await original('ellan.mods.enable', [{ path: inst.path, files: [target + '.disabled'] }])
    expect(await readFile(target)).toEqual(bytes)
    await original('ellan.mods.uninstall', [{ path: inst.path, files: [basename(target)] }])
    expect((await original<Watched>('ellan.mods.watch', [inst.path])).files).toEqual([])
    expect(await readFile(source)).toEqual(bytes)
    expect(await original<string[]>('ellan.mods.import', [{ path: inst.path, files: [source] }])).toEqual([target])
    expect((await original<ResourceFile[]>('ellan.mods.search-installed', ['Actual Fabric']))[0]).toMatchObject({ path: target, metadata: { fabric } })
  })

  it('rejects browser filenames, unknown uploads and unmanaged mutations instead of guessing paths', async () => {
    const inst = await instance(), other = await instance('Other managed fixture')
    const foreign = await jar(other, 'foreign.jar', simpleJar()), source = join(root, 'source.jar')
    await writeFile(source, simpleJar())
    await expect(original('ellan.mods.import', [{ path: inst.path, files: ['source.jar'] }])).rejects.toMatchObject({ code: 'NATIVE_PATH_REQUIRED' })
    await expect(original('ellan.mods.install', [{ path: inst.path, files: [{ name: 'source.jar' }] }])).rejects.toThrow()
    await expect(original('ellan.mods.import', [{ path: inst.path, files: [source, undefined] }])).rejects.toThrow()
    await expect(original('ellan.mods.watch', ['unknown-instance-name'])).rejects.toMatchObject({ code: 'NATIVE_PATH_REQUIRED' })
    await expect(original('ellan.mods.disable', [{ path: inst.path, files: [foreign] }])).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
    await expect(original('ellan.mods.uninstall', [{ path: inst.path, files: ['../foreign.jar'] }])).rejects.toMatchObject({ code: 'UNSAFE_PATH' })
    expect(await readFile(foreign)).toEqual(simpleJar())
    expect((await original<Watched>('ellan.mods.watch', [inst.path])).files).toEqual([])
    const own = await jar(inst, 'conflict.jar', simpleJar())
    await jar(inst, 'conflict.jar.disabled', simpleJar())
    await expect(original('ellan.mods.disable', [{ path: inst.path, files: [own] }])).rejects.toMatchObject({ code: 'FILE_EXISTS' })
    expect(await readFile(own)).toEqual(simpleJar())
  })

  it('uses persistent original group files and faithful shared-rule merge/replace semantics', async () => {
    const inst = await instance(), groups = { Core: { color: '#ffeedd', files: ['actual.jar'], icon: 'mdi-cube', pinned: true } }
    const before = await original<{ id: string; groups: unknown }>('ellan.mod-group.state', [inst.path])
    await original('ellan.mod-group.update', [inst.path, groups])
    const after = await original<{ id: string; groups: unknown }>('ellan.mod-group.state', [inst.path, 'mods'])
    expect(after).toEqual({ __state__: 'InstanceModsGroupState', id: before.id, groups })
    expect(JSON.parse(await readFile(join(inst.path, 'mod-groups.json'), 'utf8'))).toEqual(groups)
    await original('ellan.mod-group.update', [inst.path, groups, 'resourcepacks'])
    expect(JSON.parse(await readFile(join(inst.path, 'resourcepacks-groups.json'), 'utf8'))).toEqual(groups)
    await original('ellan.mod-group.rules-update', [{ Core: ['a'], Utilities: ['b'] }])
    await original('ellan.mod-group.rules-update', [{ Core: ['c'] }])
    expect(await original('ellan.mod-group.rules', [])).toEqual({ Core: ['c', 'a'], Utilities: ['b'] })
    await original('ellan.mod-group.rules-update', [{ Core: ['d'] }, ['Core']])
    expect(await original('ellan.mod-group.rules', [])).toEqual({ Core: ['d'], Utilities: ['b'] })
    await original('ellan.mod-group.rules-update', [{ Core: ['b'] }])
    expect(await original('ellan.mod-group.rules', [])).toEqual({ Core: ['b', 'd'], Utilities: [] })
    await expect(original('ellan.mod-group.state', [inst.path, '../unsafe'])).rejects.toThrow()
    await ctx.features.dispose(); ctx = await createLauncherContext({ root })
    expect((await original<{ groups: unknown }>('ellan.mod-group.state', [inst.path])).groups).toEqual(groups)
    expect(await original('ellan.mod-group.rules', [])).toEqual({ Core: ['b', 'd'], Utilities: [] })
  })

  it('returns only actual persisted provider mappings and hash-keyed source references', async () => {
    const inst = await instance(), bytes = simpleJar(), path = await jar(inst, 'actual.jar', bytes), hash = createHash('sha1').update(bytes).digest('hex')
    const mapping = { modrinthId: 'AbCd1234', curseforgeId: 42, name: 'Local fixture mapping', description: 'Persisted pair' }
    await ctx.features.call('storage.write', { file: join(root, '.rhine', 'ellan-project-mappings.json'), value: [mapping, { ...mapping, modrinthId: 'not-a-provider-id', curseforgeId: -1 }] })
    await ctx.features.call('storage.write', { file: join(root, '.rhine', 'ellan-resource-metadata.json'), value: {
      [hash]: { name: 'Actual imported reference', metadata: { modrinth: { projectId: 'PrOj1234', versionId: 'VeRs1234' }, curseforge: { projectId: 71, fileId: 72 } } },
      ['0'.repeat(40)]: { metadata: { modrinth: { projectId: path, versionId: path }, curseforge: { projectId: -1, fileId: 0 } } },
    } })
    expect(await original('ellan.project-mapping.batch', [['AbCd1234'], []])).toEqual([mapping])
    expect(await original('ellan.project-mapping.modrinth', ['AbCd1234'])).toEqual(mapping)
    expect(await original('ellan.project-mapping.curseforge', [42])).toEqual(mapping)
    expect(await original('ellan.project-mapping.keyword', ['Persisted'])).toEqual([mapping])
    expect(await original('ellan.project-mapping.batch', [[], [71]])).toEqual([{ modrinthId: 'PrOj1234', curseforgeId: 71, name: 'Actual imported reference', description: '' }])
    expect(await original('ellan.project-mapping.batch', [['NoNe1234'], []])).toEqual([])
    expect(await original('ellan.project-mapping.modrinth', ['NoNe1234'])).toBeUndefined()
    const state = await original<Watched>('ellan.mods.watch', [inst.path])
    expect(state.files[0].metadata).toMatchObject({ fabric, modrinth: { projectId: 'PrOj1234', versionId: 'VeRs1234' }, curseforge: { projectId: 71, fileId: 72 } })
    await ctx.features.dispose(); ctx = await createLauncherContext({ root })
    expect(await original('ellan.project-mapping.curseforge', [42])).toEqual(mapping)
  })

  it('registers one descriptor per operation and reveals only the managed mods directory', async () => {
    const descriptors = (await discoverFeatures()).filter(({ plugin }) => plugin.http?.path.startsWith('/api/ellan/services/InstanceModsService/') || plugin.http?.path.startsWith('/api/ellan/services/InstanceModsGroupService/') || plugin.http?.path.startsWith('/api/ellan/services/ProjectMappingService/'))
    expect(descriptors).toHaveLength(19)
    expect(new Set(descriptors.map(({ plugin }) => plugin.capability)).size).toBe(19)
    expect(new Set(descriptors.map(({ plugin }) => plugin.http?.path)).size).toBe(19)
    const inst = await instance(), revealed: unknown[] = []
    const env = { context: ctx, signal: new AbortController().signal,
      use<T>(id: string, input?: unknown): T { if (id === 'system.reveal') { revealed.push(input); return Promise.resolve({ ok: true }) as T } return ctx.features.call<T>(id, input) },
    } as FeatureEnvironment
    await showModsDirectory({ rendererId, args: [inst.path] }, env)
    expect(revealed).toEqual([{ path: join(inst.path, 'mods') }])
    expect((await stat(join(inst.path, 'mods'))).isDirectory()).toBe(true)
  })
})
