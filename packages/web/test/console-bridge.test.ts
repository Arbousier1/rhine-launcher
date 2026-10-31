import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { LauncherInstance, LauncherSession } from '../src/console/launcher-state'

type Bridge = typeof import('../src/console/launcher-bridge')
type Callback = (event: Record<string, unknown>) => void
class FixtureSocket {
  static all: FixtureSocket[] = []
  listeners = new Map<string, Set<Callback>>()
  readyState = 0
  close = vi.fn(() => { this.readyState = 3 })
  constructor(readonly url: string) { FixtureSocket.all.push(this) }
  addEventListener(type: string, listener: Callback) { if (!this.listeners.has(type)) this.listeners.set(type, new Set()); this.listeners.get(type)!.add(listener) }
  removeEventListener(type: string, listener: Callback) { this.listeners.get(type)?.delete(listener) }
  emit(type: string, event: Record<string, unknown> = {}) { for (const listener of [...this.listeners.get(type) ?? []]) listener(event) }
  open() { this.readyState = 1; this.emit('open') }
  message(value: unknown) { this.emit('message', { data: JSON.stringify(value) }) }
  disconnect() { this.readyState = 3; this.emit('close') }
  listenerCount() { return [...this.listeners.values()].reduce((sum, entries) => sum + entries.size, 0) }
}
function instance(patch: Partial<LauncherInstance> = {}): LauncherInstance {
  return { id: 'i1', name: 'Native archive', gameVersion: '1.21.4', loaders: [], path: 'C:/rhine/instances/i1', memory: { minMb: 1024, maxMb: 4096 }, jvmArgs: [], gameArgs: [], window: { width: 1280, height: 720, fullscreen: false }, createdAt: 1, revision: 1, playTimeMs: 0, ...patch }
}
function session(patch: Partial<LauncherSession> = {}): LauncherSession {
  return { id: 'real-session', instanceId: 'i1', status: 'running', accountName: 'Alex', startedAt: 100, pid: 4321, command: ['java'], logFile: 'C:/rhine/logs/game.log', ...patch }
}
function bootstrap() {
  return { app: { name: 'Rhine', version: '0.2.0', platform: 'win32', pid: 1 }, paths: { root: 'C:/rhine', instances: 'C:/rhine/instances' }, instances: [instance(), instance({ id: 'i2', name: 'Second archive' })], accounts: [{ id: 'a1', name: 'Steve', kind: 'offline', uuid: 'uuid-1' }, { id: 'a2', name: 'Alex', kind: 'offline', uuid: 'uuid-2' }], sessions: [] as LauncherSession[], tasks: [], unavailable: {} }
}
function json(value: unknown, status = 200) { return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } }) }
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
class HttpFixture {
  snapshot: unknown = bootstrap()
  calls: { path: string; method: string; body: unknown; signal?: AbortSignal | null }[] = []
  routes = new Map<string, (() => Response | Promise<Response>)[]>()
  fetch = vi.fn(async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const path = String(input), method = init?.method ?? 'GET'
    this.calls.push({ path, method, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined, signal: init?.signal })
    const response = this.routes.get(method + ' ' + path)?.shift()
    if (response) return response()
    if (method === 'GET' && path === '/api/bootstrap') return json(this.snapshot)
    throw new Error('Unexpected fixture request: ' + method + ' ' + path)
  })
  queue(method: string, path: string, response: () => Response | Promise<Response>) {
    const key = method + ' ' + path
    this.routes.set(key, [...this.routes.get(key) ?? [], response])
  }
  respond(method: string, path: string, value: unknown, status = 200) { this.queue(method, path, () => json(value, status)) }
}
let bridge: Bridge
let api: HttpFixture
let storage: Map<string, string>
beforeEach(async () => {
  vi.resetModules()
  FixtureSocket.all = []
  api = new HttpFixture()
  storage = new Map()
  vi.stubGlobal('fetch', api.fetch)
  vi.stubGlobal('location', { protocol: 'http:', host: 'launcher.fixture' })
  vi.stubGlobal('WebSocket', FixtureSocket)
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) })
  bridge = await import('../src/console/launcher-bridge')
})
afterEach(async () => {
  await bridge?.disposeLauncher()
  vi.useRealTimers()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('native launcher feature catalog and HTTP snapshots', () => {
  it('discovers nine single-capability native FeatureRuntime plugins without starting I/O on import', async () => {
    const { FeatureRuntime } = await import('@rhine/plugin-api')
    const runtime = bridge.getLauncherRuntime()
    await runtime.settled()
    expect(runtime).toBeInstanceOf(FeatureRuntime)
    expect(runtime.definitions().map(plugin => plugin.id).sort()).toEqual(['launcher.account.offline', 'launcher.bootstrap', 'launcher.events.connect', 'launcher.instance.create', 'launcher.instance.update', 'launcher.launch.start', 'launcher.mods.list', 'launcher.session.stop', 'launcher.system.reveal'])
    for (const plugin of runtime.definitions()) { expect(plugin.capability).toBe(plugin.id); expect(plugin.execute).toBeTypeOf('function'); expect(plugin.depends).toEqual([]) }
    expect(api.calls).toEqual([])
    expect(FixtureSocket.all).toEqual([])
    await runtime.disable('launcher.instance.create')
    expect(runtime.has('launcher.launch.start')).toBe(true)
    expect(runtime.has('launcher.bootstrap')).toBe(true)
  })
  it('retries a failed bootstrap, preserves UNKNOWN, and still refreshes with realtime disabled', async () => {
    const statuses: string[] = []
    bridge.subscribeStatus(() => statuses.push(bridge.getLauncherSnapshot().status))
    api.respond('GET', '/api/bootstrap', { code: 'UNKNOWN', message: 'Repository unavailable' }, 503)
    await expect(bridge.loadLauncher({ realtime: false })).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(bridge.isBootstrapped()).toBe(false)
    expect(bridge.getLauncherSnapshot()).toMatchObject({ status: 'error', error: { code: 'UNKNOWN', message: 'Repository unavailable', status: 503 }, connection: 'disabled' })
    await bridge.loadLauncher()
    expect(bridge.isBootstrapped()).toBe(true)
    expect(bridge.getLauncherSnapshot()).toMatchObject({ status: 'ready', error: null, selectedAccountId: 'a1' })
    const instances = bridge.launcherInstances()
    await bridge.loadLauncher()
    expect(bridge.launcherInstances()).toBe(instances)
    expect(api.calls).toHaveLength(3)
    expect(FixtureSocket.all).toHaveLength(0)
    expect(statuses).toContain('loading'); expect(statuses).toContain('error'); expect(statuses.at(-1)).toBe('ready')
  })
  it.each([
    ['instances', null], ['instances', [null]], ['instances', [instance({ loaders: {} as never })]],
    ['accounts', [{}]], ['sessions', {}],
  ])('rejects malformed %s without erasing the last valid list', async (field, value) => {
    await bridge.loadLauncher({ realtime: false })
    const instances = bridge.launcherInstances()
    api.snapshot = { ...bootstrap(), [field as string]: value }
    await expect(bridge.loadLauncher()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(bridge.getLauncherSnapshot().status).toBe('error')
    expect(bridge.getLauncherSnapshot().unavailable[field as string].code).toBe('INVALID_RESPONSE')
    expect(bridge.launcherInstances()).toBe(instances)
  })
  it('preserves explicit HTTP-200 unavailable sections instead of treating fallback arrays as success', async () => {
    await bridge.loadLauncher({ realtime: false })
    const instances = bridge.launcherInstances(), accounts = bridge.launcherAccounts()
    const unavailable = { instances: { feature: 'instance.list', status: 'disabled', code: 'UNKNOWN', message: 'Storage unavailable' }, accounts: { feature: 'account.list', status: 'blocked', code: 'PLUGIN_UNAVAILABLE', message: 'Account provider disabled' } }
    api.snapshot = { ...bootstrap(), instances: [], accounts: [], unavailable }
    await expect(bridge.loadLauncher()).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(bridge.launcherInstances()).toBe(instances)
    expect(bridge.launcherAccounts()).toBe(accounts)
    expect(bridge.getLauncherSnapshot().unavailable).toEqual(unavailable)
    await expect(bridge.launchInstance('i1')).rejects.toMatchObject({ code: 'UNKNOWN' })
    expect(api.calls.every(call => call.method === 'GET')).toBe(true)
  })
  it('publishes the first validated empty instance list once, without resetting it on every refresh', async () => {
    api.snapshot = { ...bootstrap(), instances: [] }
    const changed = vi.fn()
    bridge.subscribeInstances(changed)
    await bridge.loadLauncher({ realtime: false })
    expect(changed).toHaveBeenCalledTimes(1)
    expect(changed).toHaveBeenCalledWith([])
    const empty = bridge.launcherInstances()
    await bridge.loadLauncher()
    expect(changed).toHaveBeenCalledTimes(1)
    expect(bridge.launcherInstances()).toBe(empty)
  })
  it('coalesces concurrent refreshes but permits another request after they settle', async () => {
    await bridge.loadLauncher({ realtime: false })
    const response = deferred<Response>()
    api.queue('GET', '/api/bootstrap', () => response.promise)
    const first = bridge.loadLauncher(), second = bridge.loadLauncher()
    expect(bridge.getLauncherSnapshot().status).toBe('loading')
    expect(api.calls).toHaveLength(2)
    response.resolve(json(bootstrap()))
    await Promise.all([first, second])
    await bridge.loadLauncher()
    expect(api.calls).toHaveLength(3)
  })
  it('retains validated app and path metadata when optional response fields are malformed', async () => {
    await bridge.loadLauncher({ realtime: false })
    const { app, paths } = bridge.getLauncherSnapshot()
    api.snapshot = { ...bootstrap(), app: null, paths: { root: 42 } }
    await expect(bridge.loadLauncher()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(bridge.getLauncherSnapshot().app).toBe(app)
    expect(bridge.getLauncherSnapshot().paths).toBe(paths)
  })
  it('distinguishes invalid JSON from HTTP errors and never fabricates an empty successful snapshot', async () => {
    api.queue('GET', '/api/bootstrap', () => new Response('<html>bad gateway</html>', { status: 502 }))
    await expect(bridge.loadLauncher({ realtime: false })).rejects.toMatchObject({ code: 'HTTP_502', status: 502 })
    api.queue('GET', '/api/bootstrap', () => new Response('not json', { status: 200 }))
    await expect(bridge.loadLauncher()).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(bridge.isBootstrapped()).toBe(false)
    expect(bridge.getLauncherSnapshot().status).toBe('error')
  })
})

describe('selected accounts, pending actions, and actual native responses', () => {
  it('uses a valid saved second account for launch, without a second bootstrap request', async () => {
    await bridge.disposeLauncher()
    storage.set(bridge.LAUNCHER_ACCOUNT_STORAGE_KEY, 'a2')
    await bridge.loadLauncher({ realtime: false })
    expect(bridge.getLauncherSnapshot().selectedAccountId).toBe('a2')
    api.respond('POST', '/api/launch', session(), 202)
    const result = await bridge.launchInstance('i1')
    expect(result.id).toBe('real-session')
    expect(bridge.sessionFor('i1')?.pid).toBe(4321)
    expect(api.calls).toHaveLength(2)
    expect(api.calls[1]).toMatchObject({ path: '/api/launch', body: { instanceId: 'i1', accountId: 'a2', detach: true } })
    expect(bridge.getLauncherSnapshot().tasks).toEqual([])
  })
  it('persists selection, preserves it across refresh, and refuses invalid account ids', async () => {
    await bridge.loadLauncher({ realtime: false })
    bridge.setSelectedAccount('a2')
    expect(storage.get(bridge.LAUNCHER_ACCOUNT_STORAGE_KEY)).toBe('a2')
    expect(() => bridge.setSelectedAccount('missing')).toThrow(/账号/)
    await bridge.loadLauncher()
    expect(bridge.getLauncherSnapshot().selectedAccountId).toBe('a2')
  })
  it('falls back only when no valid selection remains and reports missing accounts as an action error', async () => {
    await bridge.disposeLauncher()
    storage.set(bridge.LAUNCHER_ACCOUNT_STORAGE_KEY, 'deleted')
    await bridge.loadLauncher({ realtime: false })
    expect(bridge.getLauncherSnapshot().selectedAccountId).toBe('a1')
    api.snapshot = { ...bootstrap(), accounts: [] }
    await bridge.loadLauncher()
    await expect(bridge.launchInstance('i1')).rejects.toMatchObject({ code: 'ACCOUNT_REQUIRED' })
    expect(bridge.getLauncherSnapshot().errors.i1.code).toBe('ACCOUNT_REQUIRED')
    expect(bridge.getLauncherSnapshot().pending.i1).toBeUndefined()
    expect(api.calls.filter(call => call.method === 'POST')).toHaveLength(0)
  })
  it('publishes pending and completion immediately, keys errors by instance, and never adds fake progress', async () => {
    await bridge.loadLauncher({ realtime: false })
    const instances = bridge.launcherInstances(), changed = vi.fn(), statuses: unknown[] = []
    bridge.subscribeInstances(changed); changed.mockClear()
    bridge.subscribeStatus(() => statuses.push({ pending: bridge.getLauncherSnapshot().pending.i1, error: bridge.getLauncherSnapshot().errors.i1 }))
    const failed = deferred<Response>()
    api.queue('POST', '/api/launch', () => failed.promise)
    const operation = bridge.launchInstance('i1')
    expect(bridge.getLauncherSnapshot().pending.i1).toEqual(['launch'])
    expect(bridge.launcherSessions()).toEqual([])
    expect(bridge.getLauncherSnapshot().tasks).toEqual([])
    failed.resolve(json({ code: 'JAVA_UNAVAILABLE', message: 'No compatible Java' }, 503))
    await expect(operation).rejects.toMatchObject({ code: 'JAVA_UNAVAILABLE' })
    expect(bridge.getLauncherSnapshot().pending.i1).toBeUndefined()
    expect(bridge.getLauncherSnapshot().errors.i1).toMatchObject({ code: 'JAVA_UNAVAILABLE', message: 'No compatible Java' })
    const successful = deferred<Response>()
    api.queue('POST', '/api/launch', () => successful.promise)
    const retry = bridge.launchInstance('i1')
    expect(bridge.getLauncherSnapshot().pending.i1).toEqual(['launch'])
    expect(bridge.getLauncherSnapshot().errors.i1).toBeUndefined()
    successful.resolve(json(session(), 202))
    await retry
    expect(bridge.getLauncherSnapshot().pending.i1).toBeUndefined()
    expect(bridge.launcherInstances()).toBe(instances)
    expect(changed).not.toHaveBeenCalled()
    expect(statuses.length).toBeGreaterThanOrEqual(5)
  })
  it('deduplicates the same in-flight action without losing its pending state or retaining a stale error', async () => {
    await bridge.loadLauncher({ realtime: false })
    const response = deferred<Response>()
    api.queue('POST', '/api/launch', () => response.promise)
    const original = bridge.launchInstance('i1')
    await expect(bridge.launchInstance('i1')).rejects.toMatchObject({ code: 'ACTION_PENDING' })
    expect(bridge.getLauncherSnapshot().pending.i1).toEqual(['launch'])
    expect(api.calls.filter(call => call.method === 'POST')).toHaveLength(1)
    response.resolve(json(session(), 202))
    await original
    expect(bridge.getLauncherSnapshot().pending.i1).toBeUndefined()
    expect(bridge.getLauncherSnapshot().errors.i1).toBeUndefined()
  })
  it('rejects fake task responses and stores disabled-capability failures without affecting peers', async () => {
    await bridge.loadLauncher({ realtime: false })
    api.respond('POST', '/api/launch', { taskId: 'not-a-session' }, 202)
    await expect(bridge.launchInstance('i1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(bridge.launcherSessions()).toEqual([])
    await bridge.getLauncherRuntime().disable('launcher.launch.start')
    await expect(bridge.launchInstance('i1')).rejects.toMatchObject({ code: 'PLUGIN_UNAVAILABLE' })
    expect(bridge.getLauncherSnapshot().errors.i1.code).toBe('PLUGIN_UNAVAILABLE')
    expect(bridge.getLauncherRuntime().has('launcher.instance.update')).toBe(true)
    await bridge.getLauncherRuntime().enable('launcher.launch.start')
    api.respond('POST', '/api/launch', session(), 202)
    await bridge.launchInstance('i1')
  })
  it('uses the exact create/update/offline/mods/reveal contracts and applies confirmed responses', async () => {
    await bridge.loadLauncher({ realtime: false })
    const created = instance({ id: 'i3', name: 'Created', gameVersion: '1.20.1' })
    api.respond('POST', '/api/instances', created, 201)
    await expect(bridge.createInstance({ name: 'Created', gameVersion: '1.20.1' })).resolves.toMatchObject({ id: 'i3' })
    expect(api.calls.at(-1)?.body).toEqual({ name: 'Created', gameVersion: '1.20.1' })
    api.respond('PATCH', '/api/instances/i3', { ...created, name: 'Renamed', revision: 2 })
    await bridge.updateInstance('i3', { name: 'Renamed' })
    expect(api.calls.at(-1)?.body).toEqual({ name: 'Renamed' })
    expect(bridge.launcherInstances().find(item => item.id === 'i3')?.name).toBe('Renamed')
    api.respond('POST', '/api/accounts/offline', { id: 'a3', name: 'LocalUser', kind: 'offline', uuid: 'uuid-3', accessToken: 'must-not-be-retained' }, 201)
    await bridge.addOfflineAccount('LocalUser')
    expect(api.calls.at(-1)?.body).toEqual({ name: 'LocalUser' })
    expect(bridge.launcherAccounts().at(-1)).not.toHaveProperty('accessToken')
    expect(bridge.getLauncherSnapshot().selectedAccountId).toBe('a1')
    const mods = [{ path: 'mods/sodium.jar', name: 'sodium.jar', diskName: 'sodium.jar', enabled: true, isDirectory: false, size: 123, modifiedAt: 10, meta: { name: 'Sodium', version: '0.6', authors: ['CaffeineMC'] } }]
    api.respond('GET', '/api/instances/i3/mods', mods)
    expect(await bridge.readMods('i3')).toEqual(mods)
    expect(bridge.getLauncherSnapshot().mods.i3).toEqual(mods)
    api.respond('POST', '/api/system/reveal', { ok: true })
    await bridge.revealPath('C:/rhine/instances/i3')
    expect(api.calls.at(-1)?.body).toEqual({ path: 'C:/rhine/instances/i3' })
    expect(bridge.getLauncherSnapshot().actionPending).toMatchObject({ create: 0, update: 0, account: 0, mods: 0, reveal: 0 })
  })
  it('retains real mod data on unavailable responses and refuses false success acknowledgements', async () => {
    await bridge.loadLauncher({ realtime: false })
    api.respond('GET', '/api/instances/i1/mods', [], 200)
    await bridge.readMods('i1')
    const previous = bridge.getLauncherSnapshot().mods.i1
    api.respond('GET', '/api/instances/i1/mods', { code: 'PLUGIN_UNAVAILABLE', message: 'Mod reader disabled' }, 503)
    await expect(bridge.readMods('i1')).rejects.toMatchObject({ code: 'PLUGIN_UNAVAILABLE' })
    expect(bridge.getLauncherSnapshot().mods.i1).toBe(previous)
    api.respond('GET', '/api/instances/i1/mods', { status: 'UNKNOWN' })
    await expect(bridge.readMods('i1')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    api.respond('POST', '/api/system/reveal', { ok: false })
    await expect(bridge.revealPath('C:/rhine')).rejects.toMatchObject({ code: 'INVALID_RESPONSE' })
    expect(bridge.getLauncherSnapshot().actionErrors.reveal?.code).toBe('INVALID_RESPONSE')
  })
  it('tracks stop pending until native kill acknowledges without inventing exit timestamps', async () => {
    api.snapshot = { ...bootstrap(), sessions: [session()] }
    await bridge.loadLauncher({ realtime: false })
    const instances = bridge.launcherInstances(), response = deferred<Response>()
    api.queue('POST', '/api/launch/sessions/real-session/kill', () => response.promise)
    const stopping = bridge.stopInstance('real-session')
    expect(bridge.getLauncherSnapshot().pending.i1).toEqual(['stop'])
    expect(bridge.sessionFor('i1')?.status).toBe('running')
    response.resolve(json({ ok: true }))
    await stopping
    expect(bridge.getLauncherSnapshot().pending.i1).toBeUndefined()
    expect(bridge.sessionFor('i1')).toBeUndefined()
    expect(bridge.launcherSessions()[0]).toMatchObject({ status: 'stopped' })
    expect(bridge.launcherSessions()[0].endedAt).toBeUndefined()
    expect(bridge.launcherInstances()).toBe(instances)
  })
})

describe('optional websocket lifecycle and cancellation', () => {
  it('keeps instance references and subscriptions separate from real session/task events', async () => {
    await bridge.loadLauncher()
    const socket = FixtureSocket.all[0], instances = bridge.launcherInstances(), changed = vi.fn()
    bridge.subscribeInstances(changed); changed.mockClear()
    expect(socket.url).toBe('ws://launcher.fixture/ws')
    socket.open()
    expect(bridge.getLauncherSnapshot().connection).toBe('connected')
    await bridge.loadLauncher()
    expect(FixtureSocket.all).toHaveLength(1)
    socket.message({ type: 'launch', session: session() })
    expect(bridge.sessionFor('i1')?.id).toBe('real-session')
    socket.message({ type: 'task', task: { id: 'actual-task', kind: 'download', title: 'Real backend task', status: 'running', progress: { value: -1, stage: 'download', current: 5, total: 0 }, logs: [], createdAt: 100 } })
    expect(bridge.getLauncherSnapshot().tasks[0].progress.value).toBe(-1)
    socket.message({ type: 'launch-exit', sessionId: 'real-session', status: 'exited', exitCode: 0 })
    expect(bridge.sessionFor('i1')).toBeUndefined()
    expect(bridge.launcherSessions()[0]).toMatchObject({ status: 'exited', exitCode: 0 })
    expect(bridge.launcherInstances()).toBe(instances)
    expect(changed).not.toHaveBeenCalled()
    socket.message({ type: 'instance', instance: instance({ name: 'Real update', revision: 2 }) })
    expect(changed).toHaveBeenCalledTimes(1)
    socket.message({ type: 'instance-removed', id: 'i2' })
    expect(bridge.launcherInstances()).toHaveLength(1)
  })
  it('quarantines malformed events without crashing or erasing data', async () => {
    await bridge.loadLauncher()
    const socket = FixtureSocket.all[0], instances = bridge.launcherInstances()
    socket.open()
    for (const data of ['{', 'null', '[]', '{"type":"instance","instance":null}', '{"type":"launch","session":{"id":"broken"}}']) expect(() => socket.emit('message', { data })).not.toThrow()
    expect(bridge.launcherInstances()).toBe(instances)
    expect(bridge.launcherSessions()).toEqual([])
    expect(bridge.getLauncherSnapshot().connectionError).not.toBeNull()
    expect(bridge.getLauncherSnapshot().status).toBe('ready')
    expect(() => socket.message({ type: 'future-event', payload: null })).not.toThrow()
  })
  it('shows disconnect/reconnect, resyncs HTTP, and ignores old sockets after replacement', async () => {
    await bridge.loadLauncher()
    vi.useFakeTimers()
    const first = FixtureSocket.all[0], statuses: string[] = []
    first.open()
    const lateClose = [...first.listeners.get('close')!][0]
    bridge.subscribeStatus(() => statuses.push(bridge.getLauncherSnapshot().connection))
    first.disconnect()
    expect(statuses).toContain('disconnected')
    expect(bridge.getLauncherSnapshot().connection).toBe('reconnecting')
    expect(first.listenerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(1000)
    expect(FixtureSocket.all).toHaveLength(2)
    const second = FixtureSocket.all[1]
    second.open()
    await Promise.resolve(); await Promise.resolve()
    expect(api.calls).toHaveLength(2)
    expect(bridge.getLauncherSnapshot().connection).toBe('connected')
    lateClose({})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FixtureSocket.all).toHaveLength(2)
  })
  it('clears reconnect timers on disable while preserving independent HTTP refresh', async () => {
    await bridge.loadLauncher()
    vi.useFakeTimers()
    const first = FixtureSocket.all[0], lateClose = [...first.listeners.get('close')!][0]
    first.disconnect()
    expect(vi.getTimerCount()).toBe(1)
    await bridge.getLauncherRuntime().disable('launcher.events.connect')
    expect(vi.getTimerCount()).toBe(0)
    expect(bridge.getLauncherSnapshot().connection).toBe('disabled')
    lateClose({})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FixtureSocket.all).toHaveLength(1)
    expect(bridge.getLauncherRuntime().has('launcher.bootstrap')).toBe(true)
    await bridge.loadLauncher()
    expect(api.calls).toHaveLength(2)
    expect(bridge.getLauncherSnapshot().status).toBe('ready')
    expect(FixtureSocket.all).toHaveLength(1)
    await bridge.loadLauncher({ realtime: true })
    expect(FixtureSocket.all).toHaveLength(2)
  })
  it('closes replacement sockets, external signal scopes, and the final runtime without reconnect leaks', async () => {
    await bridge.loadLauncher()
    vi.useFakeTimers()
    const runtime = bridge.getLauncherRuntime(), first = FixtureSocket.all[0], lateClose = [...first.listeners.get('close')!][0]
    runtime.call('launcher.events.connect', { force: true })
    expect(first.close).toHaveBeenCalledTimes(1)
    expect(first.listenerCount()).toBe(0)
    const second = FixtureSocket.all[1], controller = new AbortController()
    runtime.call('launcher.events.connect', { force: true }, { signal: controller.signal })
    expect(second.close).toHaveBeenCalledTimes(1)
    const third = FixtureSocket.all[2]
    controller.abort()
    expect(third.close).toHaveBeenCalledTimes(1)
    expect(third.listenerCount()).toBe(0)
    runtime.call('launcher.events.connect')
    const fourth = FixtureSocket.all[3]
    await bridge.disposeLauncher()
    expect(fourth.close).toHaveBeenCalledTimes(1)
    expect(fourth.listenerCount()).toBe(0)
    lateClose({})
    await vi.advanceTimersByTimeAsync(60_000)
    expect(FixtureSocket.all).toHaveLength(4)
    expect(vi.getTimerCount()).toBe(0)
    expect(bridge.getLauncherSnapshot().connection).toBe('disabled')
  })
  it('supports explicit close and reports unavailable realtime without failing HTTP', async () => {
    await bridge.loadLauncher()
    const handle = bridge.getLauncherRuntime().call<{ close(): void }>('launcher.events.connect')
    handle.close()
    expect(bridge.getLauncherSnapshot().connection).toBe('disconnected')
    expect(FixtureSocket.all[0].close).toHaveBeenCalledTimes(1)
    vi.stubGlobal('WebSocket', undefined)
    await bridge.loadLauncher()
    expect(bridge.getLauncherSnapshot()).toMatchObject({ status: 'ready', connection: 'disconnected', connectionError: { code: 'REALTIME_UNAVAILABLE' } })
  })
  it('aborts in-flight HTTP on feature disable, permits retry, and ignores a late transport response', async () => {
    const runtime = bridge.getLauncherRuntime()
    await runtime.settled()
    const response = deferred<Response>()
    api.queue('GET', '/api/bootstrap', () => response.promise)
    const pending = runtime.call<Promise<void>>('launcher.bootstrap')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'PLUGIN_CANCELLED' })
    expect(api.calls[0].signal?.aborted).toBe(false)
    await runtime.disable('launcher.bootstrap')
    await rejected
    expect(api.calls[0].signal?.aborted).toBe(true)
    response.resolve(json(bootstrap()))
    await Promise.resolve(); await Promise.resolve()
    expect(bridge.isBootstrapped()).toBe(false)
    expect(bridge.getLauncherSnapshot().status).toBe('error')
    await runtime.enable('launcher.bootstrap')
    await bridge.loadLauncher({ realtime: false })
    expect(bridge.getLauncherSnapshot().status).toBe('ready')
  })
  it('clears per-instance pending on action abort and never inserts a late successful response', async () => {
    await bridge.loadLauncher({ realtime: false })
    const response = deferred<Response>()
    api.queue('POST', '/api/launch', () => response.promise)
    const pending = bridge.launchInstance('i1')
    const rejected = expect(pending).rejects.toMatchObject({ code: 'PLUGIN_CANCELLED' })
    await bridge.getLauncherRuntime().disable('launcher.launch.start')
    await rejected
    expect(bridge.getLauncherSnapshot().pending.i1).toBeUndefined()
    expect(bridge.getLauncherSnapshot().errors.i1.code).toBe('PLUGIN_CANCELLED')
    response.resolve(json(session(), 202))
    await Promise.resolve(); await Promise.resolve()
    expect(bridge.launcherSessions()).toEqual([])
  })
  it('does not let a stale HTTP snapshot overwrite newer websocket changes', async () => {
    await bridge.loadLauncher()
    const response = deferred<Response>(), socket = FixtureSocket.all[0]
    api.queue('GET', '/api/bootstrap', () => response.promise)
    const refresh = bridge.loadLauncher()
    socket.message({ type: 'instance', instance: instance({ name: 'Newer websocket value', revision: 2 }) })
    socket.message({ type: 'instance-removed', id: 'i2' })
    socket.message({ type: 'launch', session: session() })
    socket.message({ type: 'task', task: { id: 'real-progress', kind: 'download', title: 'Download', status: 'running', progress: { value: 0.5, stage: 'download', current: 5, total: 10 }, logs: [], createdAt: 1 } })
    const instances = bridge.launcherInstances()
    response.resolve(json(bootstrap()))
    await refresh
    expect(bridge.launcherInstances()).toBe(instances)
    expect(bridge.launcherInstances().map(item => item.name)).toEqual(['Newer websocket value'])
    expect(bridge.sessionFor('i1')?.id).toBe('real-session')
    expect(bridge.getLauncherSnapshot().tasks[0].progress.value).toBe(0.5)
  })
  it('preserves unknown session states without mistaking them for terminal sessions', async () => {
    api.snapshot = { ...bootstrap(), sessions: [session({ status: 'UNKNOWN' })] }
    await bridge.loadLauncher()
    expect(bridge.launcherSessions()[0].status).toBe('UNKNOWN')
    expect(bridge.sessionFor('i1')).toBeUndefined()
    FixtureSocket.all[0].message({ type: 'launch', session: session() })
    expect(bridge.sessionFor('i1')?.status).toBe('running')
  })
  it('does not resurrect a session when an exit event beats the 202 response', async () => {
    await bridge.loadLauncher()
    const response = deferred<Response>()
    api.queue('POST', '/api/launch', () => response.promise)
    const pending = bridge.launchInstance('i1'), socket = FixtureSocket.all[0]
    socket.message({ type: 'launch', session: session() })
    socket.message({ type: 'launch-exit', sessionId: 'real-session', status: 'crashed', exitCode: 1 })
    response.resolve(json(session(), 202))
    await pending
    expect(bridge.launcherSessions()[0]).toMatchObject({ status: 'crashed', exitCode: 1 })
    expect(bridge.sessionFor('i1')).toBeUndefined()
  })
})
