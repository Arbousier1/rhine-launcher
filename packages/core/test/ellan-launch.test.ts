import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { spawn } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { FeatureRuntime, defineFeature } from '@rhine/plugin-api'
import { toOriginalUser } from '@rhine/ellan-ui/projections'
import { parseOriginalServerVersion } from '@rhine/ellan-ui/diagnostics'
import { createLauncherContext } from '../src/plugins/boot.ts'
import { probeOriginalJava, type OriginalGameProcess, type OriginalLaunchOptions } from '../src/ellan/launch.ts'
import type { RhContext } from '../src/contracts.ts'
import type { Account, Instance, LaunchSession } from '../src/types.ts'
import launchPlugin from '../src/plugins/features/ellan/launch-start.plugin.ts'
import argsPlugin from '../src/plugins/features/ellan/launch-generate-arguments.plugin.ts'
import processPlugin from '../src/plugins/features/ellan/launch-get-game-process.plugin.ts'
import processesPlugin from '../src/plugins/features/ellan/game-processes.plugin.ts'
import killPlugin from '../src/plugins/features/ellan/launch-kill.plugin.ts'
import installPlugin from '../src/plugins/features/ellan/version-install-install.plugin.ts'
import aliasPlugin from '../src/plugins/features/ellan/version-install-instance.plugin.ts'
import diagnosePlugin from '../src/plugins/features/ellan/version-install-diagnose.plugin.ts'
import refreshPlugin from '../src/plugins/features/ellan/user-refresh.plugin.ts'
import agentPlugin from '../src/plugins/features/ellan/authlib-agent.plugin.ts'

const call = (args: unknown[] = []) => ({ rendererId: 'isolated-ellan-test', args })
const sha1 = (value: string | Buffer) => createHash('sha1').update(value).digest('hex')
const CLIENT = Buffer.from('TEST_ONLY_FAKE_CLIENT_JAR')
const SERVER = Buffer.from('TEST_ONLY_FAKE_SERVER_JAR')
const LIBRARY = Buffer.from('TEST_ONLY_FAKE_LIBRARY')
const ASSET = Buffer.from('TEST_ONLY_FAKE_ASSET')
const INDEX = Buffer.from(JSON.stringify({ objects: { 'fixture/small.txt': { hash: sha1(ASSET), size: ASSET.length } } }))
let executableRoot: string, fakeJava: string

/** Only this test compiles/executes the fake runtime. Production has no test mode. */
async function fakeExecutable(directory: string): Promise<string> {
  if (process.platform !== 'win32') {
    const path = join(directory, 'test-only-java.mjs')
    await writeFile(path, '#!' + process.execPath + '\n' + [
      'const args=process.argv.slice(2)',
      'if(args.includes("-version")){console.error("java.version = 17.0.15\\njava.vendor = Isolated fixture\\nos.arch = amd64");process.exit(0)}',
      'console.log("TEST_ONLY_FAKE_EXECUTABLE")',
      'console.log("CWD:"+process.cwd());console.log("ENV:"+process.env.ELLAN_FIXTURE_MARK)',
      'console.log("ARGV:"+args.join("|"));console.error("actual fixture stderr")',
      'setTimeout(()=>{if(process.env.ELLAN_FIXTURE_READY==="1")console.log("LWJGL Version: TEST_ONLY")},650)',
      'if(process.env.ELLAN_FIXTURE_STAY==="1")setInterval(()=>{},1000);else setTimeout(()=>process.exit(0),1300)',
    ].join('\n'))
    await chmod(path, 0o755)
    return path
  }
  const source = join(directory, 'TestOnlyJava.cs'), executable = join(directory, 'test-only-java.exe')
  await writeFile(source, [
    'using System; using System.IO; using System.Threading;',
    'class TestOnlyJava { static int Main(string[] args) {',
    'if(Array.IndexOf(args,"-version")>=0) { Console.Error.WriteLine("java.version = 17.0.15");Console.Error.WriteLine("java.vendor = Isolated fixture");Console.Error.WriteLine("os.arch = amd64");return 0; }',
    'Console.WriteLine("TEST_ONLY_FAKE_EXECUTABLE");Console.WriteLine("CWD:"+Directory.GetCurrentDirectory());',
    'Console.WriteLine("ENV:"+Environment.GetEnvironmentVariable("ELLAN_FIXTURE_MARK"));',
    'Console.WriteLine("ARGV:"+String.Join("|",args));Console.Error.WriteLine("actual fixture stderr");',
    'Thread.Sleep(650); if(Environment.GetEnvironmentVariable("ELLAN_FIXTURE_READY")=="1") Console.WriteLine("LWJGL Version: TEST_ONLY");',
    'if(Environment.GetEnvironmentVariable("ELLAN_FIXTURE_STAY")=="1") while(true) Thread.Sleep(1000);',
    'Thread.Sleep(650);return 0; }}',
  ].join('\n'))
  const compiler = join(process.env.WINDIR ?? 'C:\\Windows', 'Microsoft.NET', 'Framework64', 'v4.0.30319', 'csc.exe')
  if (!(await stat(compiler).catch(() => undefined))?.isFile()) throw new Error('Local .NET compiler required for the isolated fake executable fixture')
  await new Promise<void>((resolveCompile, reject) => {
    const child = spawn(compiler, ['/nologo', '/target:exe', '/out:' + executable, source], { shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] })
    let output = ''
    child.stdout?.on('data', chunk => { output += String(chunk) }); child.stderr?.on('data', chunk => { output += String(chunk) })
    child.once('error', reject); child.once('close', code => code === 0 ? resolveCompile() : reject(new Error('Fixture compiler failed: ' + output)))
  })
  return executable
}
beforeAll(async () => { executableRoot = await mkdtemp(join(tmpdir(), 'rhine-ellan-exe-')); fakeJava = await fakeExecutable(executableRoot) })
afterAll(async () => { if (executableRoot) await rm(executableRoot, { recursive: true, force: true }) })
interface Fixture { root: string; ctx: RhContext; instance: Instance; account: Account; server: Server; requests: string[]; base: string }
const fixtures: Fixture[] = [], runtimes: FeatureRuntime[] = []
afterEach(async () => {
  for (const runtime of runtimes.splice(0)) await runtime.dispose()
  for (const fixture of fixtures.splice(0)) {
    await fixture.ctx.features.dispose()
    await new Promise<void>((resolveClose, reject) => fixture.server.close(error => error ? reject(error) : resolveClose()))
    // The only data deleted belongs to this test's mkdtemp root.
    if (!resolve(fixture.root).startsWith(resolve(join(tmpdir(), 'rhine-ellan-launch-')))) throw new Error('Unexpected cleanup path')
    await rm(fixture.root, { recursive: true, force: true })
  }
})
async function fixture(): Promise<Fixture> {
  const root = await mkdtemp(join(tmpdir(), 'rhine-ellan-launch-')), requests: string[] = []
  const responses = new Map([['/client.jar', CLIENT], ['/server.jar', SERVER], ['/library.jar', LIBRARY], ['/index.json', INDEX], ['/' + sha1(ASSET).slice(0, 2) + '/' + sha1(ASSET), ASSET]])
  const server = createServer((request, response) => {
    requests.push(request.url ?? '')
    const value = responses.get(request.url ?? '')
    if (!value) { response.writeHead(404); response.end('Unknown test fixture'); return }
    response.writeHead(200, { 'Content-Length': value.length }); response.end(value)
  })
  await new Promise<void>((resolveListen, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', () => resolveListen()) })
  const address = server.address(); if (!address || typeof address === 'string') throw new Error('No isolated fixture port')
  const base = 'http://127.0.0.1:' + address.port
  const ctx = await createLauncherContext({ root })
  const account = await ctx.accounts.addOffline('EllanFixture')
  const instance = await ctx.instances.create({ name: 'Isolated Ellan launch', gameVersion: '1.20.1', loaders: [],
    memory: { minMb: 512, maxMb: 2048 }, jvmArgs: ['-DcoreDefault=must-not-override-original'], gameArgs: ['--core-default'],
    window: { width: 854, height: 480, fullscreen: false } })
  const value = { root, ctx, instance, account, server, requests, base }; fixtures.push(value)
  await writeVersion(value, '1.20.1')
  return value
}
async function writeVersion(fixture: Fixture, id: string) {
  const paths = fixture.ctx.paths.get(), folder = join(paths.versions, id)
  await mkdir(folder, { recursive: true })
  const version = {
    id, type: 'release', mainClass: 'net.minecraft.client.main.Main', time: '2024-01-01T00:00:00Z', releaseTime: '2024-01-01T00:00:00Z',
    javaVersion: { component: 'java-runtime-gamma', majorVersion: 17 },
    downloads: { client: { url: fixture.base + '/client.jar', sha1: sha1(CLIENT), size: CLIENT.length }, server: { url: fixture.base + '/server.jar', sha1: sha1(SERVER), size: SERVER.length } },
    assets: 'test-assets', assetIndex: { id: 'test-assets', url: fixture.base + '/index.json', sha1: sha1(INDEX), size: INDEX.length },
    libraries: [{ name: 'fixture:library:1.0', downloads: { artifact: { path: 'fixture/library/1.0/library-1.0.jar', url: fixture.base + '/library.jar', sha1: sha1(LIBRARY), size: LIBRARY.length } } }],
    arguments: { jvm: ['-cp', '${classpath}'], game: ['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}', '--accessToken', '${auth_access_token}', '--assetIndex', '${assets_index_name}'] },
  }
  // Keep placeholders literal rather than interpolating them in test source generation.
  const json = JSON.stringify(version)
  await writeFile(join(folder, id + '.json'), json)
  await writeFile(join(folder, id + '.jar'), CLIENT)
  const library = join(paths.libraries, 'fixture/library/1.0/library-1.0.jar')
  await mkdir(join(paths.libraries, 'fixture/library/1.0'), { recursive: true }); await writeFile(library, LIBRARY)
  await mkdir(join(paths.assets, 'indexes'), { recursive: true }); await writeFile(join(paths.assets, 'indexes/test-assets.json'), INDEX)
  await mkdir(join(paths.assets, 'objects', sha1(ASSET).slice(0, 2)), { recursive: true }); await writeFile(join(paths.assets, 'objects', sha1(ASSET).slice(0, 2), sha1(ASSET)), ASSET)
  await fixture.ctx.features.call('settings.update', { mirrors: { ...fixture.ctx.settings.get().mirrors, assets: fixture.base } })
}
function options(fixture: Fixture, overrides: Partial<OriginalLaunchOptions> = {}): OriginalLaunchOptions {
  return { version: '1.20.1', gameDirectory: fixture.instance.path, java: fakeJava, user: { ...toOriginalUser(fixture.account) }, side: 'client',
    minMemory: 768, maxMemory: 1536, vmOptions: ['-Doriginal=two words'], mcOptions: ['--original-option', 'some value'],
    resolution: { width: 1111, height: 777, fullscreen: false }, operationId: 'operation-fixture',
    env: { ELLAN_FIXTURE_MARK: 'inherited-original-options' }, ...overrides }
}
async function original<T>(fixture: Fixture, id: string, args: unknown[] = []): Promise<T> {
  return (await fixture.ctx.features.call<Promise<{ result: T }>>(id, call(args))).result
}
function serviceEvents(events: unknown[], name: string) {
  return events.flatMap(value => {
    const event = value as { type?: string; channel?: string; args?: { service: string; event: string; args: Record<string, unknown>[] }[] }
    if (event.type !== 'ellan' || event.channel !== 'service-event') return []
    return (event.args ?? []).filter(value => value.service === 'LaunchService' && value.event === name).map(value => value.args[0])
  })
}

describe('original operation descriptors', () => {
  it('declares exactly one HTTP operation and capability per original method', () => {
    const plugins = [launchPlugin, argsPlugin, processPlugin, processesPlugin, killPlugin, installPlugin, aliasPlugin, diagnosePlugin, refreshPlugin, agentPlugin]
    expect(new Set(plugins.map(plugin => plugin.id)).size).toBe(plugins.length)
    expect(new Set(plugins.map(plugin => plugin.http!.path)).size).toBe(plugins.length)
    for (const plugin of plugins) { expect(plugin.capability).toBe(plugin.id); expect(plugin.http?.method).toBe('POST'); expect(plugin.http?.path).toMatch(/^\/api\/ellan\/services\//) }
    expect(aliasPlugin.http?.path).toBe('/api/ellan/services/VersionInstallService/installInstance')
  })
  it('preserves installInstance as a strict instance-only alias of install', async () => {
    const runtime = new FeatureRuntime(); runtimes.push(runtime)
    const requests: unknown[] = []
    runtime.register(defineFeature({ id: 'ellan.version-install.install', capability: 'ellan.version-install.install', title: 'test-only install contract', execute(input) { requests.push(input); return { result: { version: 'contract-fixture', timestamp: 12, duration: 3, timings: [] } } } }))
    runtime.register(aliasPlugin); await runtime.start()
    const input = call([{ type: 'instance', instancePath: '/isolated', runtime: { minecraft: '1.20.1' }, selectedVersion: '' }])
    expect(await runtime.call(aliasPlugin.id, input)).toEqual({ result: { version: 'contract-fixture', timestamp: 12, duration: 3, timings: [] } })
    expect(requests).toEqual([input])
    await expect(runtime.call(aliasPlugin.id, call([{ type: 'java', target: {} }]))).rejects.toMatchObject({ code: 'INVALID_ORIGINAL_CALL' })
  })
  it('delegates authlib preparation to the actual declared core capability, never a pretend ready flag', async () => {
    const runtime = new FeatureRuntime(); runtimes.push(runtime)
    let preparations = 0
    runtime.register(defineFeature({ id: 'auth.agent.prepare', capability: 'auth.agent.prepare', title: 'isolated agent path fixture', execute() { preparations++; return join(executableRoot, 'test-only-agent.jar') } }))
    runtime.register(agentPlugin); await runtime.start()
    expect(await runtime.call(agentPlugin.id, call())).toEqual({ result: join(executableRoot, 'test-only-agent.jar') }); expect(preparations).toBe(1)
    await runtime.disable('auth.agent.prepare'); expect(runtime.has(agentPlugin.id)).toBe(false)
    expect(() => runtime.call(agentPlugin.id, call())).toThrow()
  })
})

describe('maintained original file and Java diagnosis', () => {
  it('checks current jar/library/assets content and the actual id-named asset index', async () => {
    const f = await fixture(), paths = f.ctx.paths.get()
    expect(await original(f, diagnosePlugin.id, [{ version: '1.20.1', side: 'client' }])).toBeUndefined()
    await writeFile(join(paths.versions, '1.20.1/1.20.1.jar'), 'CORRUPT')
    await rm(join(paths.libraries, 'fixture/library/1.0/library-1.0.jar'))
    await rm(join(paths.assets, 'objects', sha1(ASSET).slice(0, 2), sha1(ASSET)))
    const issue = await original<Record<string, unknown>>(f, diagnosePlugin.id, [{ version: '1.20.1', side: 'client' }])
    expect(issue.jar).toBe('1.20.1'); expect(issue.libraries).toHaveLength(1); expect(issue.assets).toHaveLength(1)
    await writeFile(join(paths.assets, 'indexes/test-assets.json'), '{}')
    expect(await original(f, diagnosePlugin.id, [{ version: '1.20.1', side: 'client' }])).toHaveProperty('assetsIndex')
    await rm(join(paths.versions, '1.20.1/1.20.1.json'))
    await expect(original(f, diagnosePlugin.id, [{ version: '1.20.1', side: 'client' }])).rejects.toThrow()
  })
  it('probes a real test executable and rejects missing or non-Java executables', async () => {
    expect(await probeOriginalJava(fakeJava, new AbortController().signal)).toMatchObject({ path: fakeJava, majorVersion: 17, vendor: 'Isolated fixture', arch: 'x64' })
    await expect(probeOriginalJava(join(executableRoot, 'missing.exe'), new AbortController().signal)).rejects.toMatchObject({ name: 'LaunchException', exception: { type: 'launchInvalidJavaPath' } })
    await expect(probeOriginalJava(process.execPath, new AbortController().signal)).rejects.toThrow()
  })
  it('re-diagnoses in both install paths and repairs only tiny isolated localhost fixtures', async () => {
    const f = await fixture(), paths = f.ctx.paths.get()
    await writeFile(join(paths.versions, '1.20.1/1.20.1.jar'), 'BROKEN')
    const request = { type: 'instance', instancePath: f.instance.path, runtime: { minecraft: '1.20.1' }, selectedVersion: '', issue: undefined }
    const installed = await original<{ version: string; timestamp: number; duration: number; timings: unknown[] }>(f, installPlugin.id, [request])
    expect(installed.version).toBe('1.20.1'); expect(installed.timestamp).toBeTypeOf('number'); expect(installed.duration).toBeGreaterThanOrEqual(0); expect(installed.timings.length).toBeGreaterThan(0)
    expect(await readFile(join(paths.versions, '1.20.1/1.20.1.jar'))).toEqual(CLIENT); expect(f.requests).toContain('/client.jar')
    await writeFile(join(paths.libraries, 'fixture/library/1.0/library-1.0.jar'), 'BROKEN_LIBRARY')
    const aliased = await original<{ version: string }>(f, aliasPlugin.id, [request])
    expect(aliased.version).toBe('1.20.1'); expect(await readFile(join(paths.libraries, 'fixture/library/1.0/library-1.0.jar'))).toEqual(LIBRARY)
    expect(await original(f, diagnosePlugin.id, [{ version: '1.20.1', side: 'client' }])).toBeUndefined()
    expect(JSON.parse(await readFile(join(paths.versions, '1.20.1/.install-lock'), 'utf8'))).toMatchObject({ schemaVersion: 1, version: '1.20.1' })
  })
  it('installs a genuine original vanilla server profile without using a client loader as server', async () => {
    const f = await fixture()
    expect(await original(f, installPlugin.id, [{ type: 'server', path: f.instance.path, runtime: { minecraft: '1.20.1' } }])).toBe('1.20.1')
    const profile = await parseOriginalServerVersion(f.root, '1.20.1')
    expect(profile.jar).toBe('net/minecraft/server/1.20.1/server-1.20.1-bundled.jar')
    expect(await original(f, diagnosePlugin.id, [{ version: '1.20.1', side: 'server' }])).toBeUndefined()
    const command = await original<string[]>(f, argsPlugin.id, [options(f, { side: 'server', nogui: true })])
    expect(command[0]).toBe(fakeJava); expect(command).toContain('-jar'); expect(command).toContain('nogui')
    await expect(original(f, installPlugin.id, [{ type: 'server', path: f.instance.path, runtime: { minecraft: '1.20.1', fabricLoader: '0.16.9' } }])).rejects.toMatchObject({ code: 'UNSUPPORTED_SERVER_LOADER' })
  })
})

describe('real isolated core launch contract', () => {
  it('generates usable original selected-version options instead of overriding them with instance defaults', async () => {
    const f = await fixture(); await writeVersion(f, '1.20.2')
    const metadata = join(f.ctx.paths.get().versions, '1.20.2', '1.20.2.json')
    const json = JSON.parse(await readFile(metadata, 'utf8')); json.assets = 'legacy-alias-not-the-core-index'
    await writeFile(metadata, JSON.stringify(json))
    const command = await original<string[]>(f, argsPlugin.id, [options(f, { version: '1.20.2', server: { host: 'example.invalid', port: 25566 }, world: 'fixture-world' })])
    expect(command[0]).toBe(fakeJava); expect(command).toContain('-Xms768M'); expect(command).toContain('-Xmx1536M')
    expect(command).toContain('1.20.2'); expect(command).toContain('-Doriginal=two words'); expect(command).not.toContain('-DcoreDefault=must-not-override-original')
    expect(command).toContain('--original-option'); expect(command).not.toContain('--core-default')
    expect(command).toContain('--width'); expect(command).toContain('1111'); expect(command).toContain('--quickPlayMultiplayer'); expect(command).toContain('example.invalid:25566'); expect(command).toContain('fixture-world')
    expect(command).toContain('test-assets'); expect(command).not.toContain('legacy-alias-not-the-core-index'); expect(f.requests).toEqual([])
    expect(await original(f, processesPlugin.id)).toEqual([])
  })
  it('preserves original missing-Java exceptions and rejects invalid launch flags before starting', async () => {
    const f = await fixture()
    await expect(original(f, argsPlugin.id, [options(f, { java: '' })])).rejects.toMatchObject({ name: 'LaunchException', exception: { type: 'launchNoProperJava', javaPath: '' } })
    await expect(original(f, argsPlugin.id, [{ ...options(f), skipAssetsCheck: 'pretend-ready' }])).rejects.toMatchObject({ code: 'INVALID_ORIGINAL_CALL' })
    expect(await original(f, processesPlugin.id)).toEqual([])
  })
  it('returns the real numeric PID, retains launchId/options/env, and emits genuine start/log/exit without fake ready', async () => {
    const f = await fixture(), events: unknown[] = [], unsubscribe = f.ctx.bus.subscribe(event => events.push(event))
    const input = options(f), processId = await original<number>(f, launchPlugin.id, [input])
    expect(processId).toBeTypeOf('number'); expect(processId).toBeGreaterThan(0); expect(() => process.kill(processId, 0)).not.toThrow()
    const processInfo = await original<OriginalGameProcess>(f, processPlugin.id, [processId])
    expect(processInfo).toMatchObject({ pid: processId, side: 'client', ready: false, options: input }); expect(processInfo.launchId).toBeTypeOf('string')
    processInfo.options.vmOptions!.push('mutated-client-copy')
    expect((await original<OriginalGameProcess>(f, processPlugin.id, [processId])).options.vmOptions).not.toContain('mutated-client-copy')
    await vi.waitFor(() => expect(serviceEvents(events, 'minecraft-stdout').some(value => String(value.stdout).includes('ENV:inherited-original-options'))).toBe(true), { timeout: 5000 })
    expect((await original<OriginalGameProcess[]>(f, processesPlugin.id))[0].ready).toBe(false)
    await vi.waitFor(() => expect(serviceEvents(events, 'minecraft-exit')).toHaveLength(1), { timeout: 6000 })
    expect(serviceEvents(events, 'minecraft-start')).toHaveLength(1); expect(serviceEvents(events, 'minecraft-window-ready')).toEqual([])
    expect(serviceEvents(events, 'minecraft-stderr').some(value => String(value.stderr).includes('actual fixture stderr'))).toBe(true)
    expect(serviceEvents(events, 'minecraft-exit')[0]).toMatchObject({ pid: processId, launchId: processInfo.launchId, gameDirectory: f.instance.path, code: 0, operationId: 'operation-fixture' })
    expect(await original(f, processPlugin.id, [processId])).toBeUndefined(); expect(await original(f, processesPlugin.id)).toEqual([])
    await vi.waitFor(() => expect(f.ctx.features.call<LaunchSession>('session.get', { id: processInfo.launchId }).status).toBe('exited'))
    unsubscribe()
  })
  it('marks ready only after maintained watcher output and kills the actual owned session', async () => {
    const f = await fixture(), events: unknown[] = [], unsubscribe = f.ctx.bus.subscribe(event => events.push(event))
    const processId = await original<number>(f, launchPlugin.id, [options(f, { env: { ELLAN_FIXTURE_READY: '1', ELLAN_FIXTURE_STAY: '1' } })])
    expect((await original<OriginalGameProcess>(f, processPlugin.id, [processId])).ready).toBe(false)
    await vi.waitFor(async () => expect((await original<OriginalGameProcess>(f, processPlugin.id, [processId])).ready).toBe(true), { timeout: 6000 })
    expect(serviceEvents(events, 'minecraft-window-ready')).toHaveLength(1)
    await original(f, killPlugin.id, [processId, true])
    expect(() => process.kill(processId, 0)).toThrow(); expect(await original(f, processesPlugin.id)).toEqual([])
    expect(serviceEvents(events, 'minecraft-exit')).toHaveLength(1); unsubscribe()
  })
  it('refreshes the actual core account and emits original userProfile and refresh-success state/events', async () => {
    const f = await fixture(), events: unknown[] = [], unsubscribe = f.ctx.bus.subscribe(event => events.push(event))
    const state = await original<{ id: string }>(f, 'ellan.user.state')
    expect(await original(f, refreshPlugin.id, [f.account.id, { force: true, silent: true }])).toEqual(toOriginalUser(f.account))
    expect(events.some(value => { const event = value as { channel?: string; args?: unknown[] }; return event.channel === 'commit' && event.args?.[0] === state.id && event.args?.[1] === 'userProfile' })).toBe(true)
    expect(events.some(value => { const event = value as { channel?: string; args?: { service: string; event: string }[] }; return event.channel === 'service-event' && event.args?.[0]?.service === 'UserService' && event.args[0].event === 'user-refresh-success' })).toBe(true)
    unsubscribe()
  })
})
