/**
 * Route tests for the HTTP shell.
 *
 * Each case drives the real Hono app through `app.request()` against the
 * in-memory context, so routing, validation, error mapping and delegation to
 * core are all exercised together.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { createServerApp } from '../src/app.ts'
import { ENTRY_DOCUMENT } from '../src/static.ts'
import { createMockContext, makeInstance } from './mock-context.ts'

/** Shorthand: build the app plus its mock for one test. */
function setup(options: Parameters<typeof createMockContext>[0] = {}) {
  const mock = createMockContext(options)
  const app = createServerApp(mock.ctx)
  return { ...mock, app }
}

/** Fetch JSON from the app. */
async function getJson(app: ReturnType<typeof createServerApp>, path: string): Promise<Response> {
  return app.request(path)
}

describe('GET /api/health', () => {
  it('reports every mounted service', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/health')
    expect(response.status).toBe(200)
    const body = await response.json() as { ok: boolean; services: Record<string, boolean> }
    expect(body.ok).toBe(true)
    expect(body.services.instances).toBe(true)
  })
})

describe('GET /api/bootstrap', () => {
  it('assembles the bootstrap snapshot from every service', async () => {
    const { app, ctx } = setup()
    const response = await getJson(app, '/api/bootstrap')
    expect(response.status).toBe(200)
    const body = await response.json() as {
      app: { name: string; pid: number; platform: string }
      paths: { root: string; instances: string }
      settings: { theme: string }
      instances: unknown[]
      accounts: unknown[]
      javaRuntimes: unknown[]
      sessions: unknown[]
      tasks: unknown[]
    }
    expect(body.app.name).toBe('Rhine Launcher')
    expect(body.app.pid).toBe(process.pid)
    expect(body.paths.root).toBe('C:/rhine-data')
    expect(body.paths.instances).toBe('C:/rhine-data/instances')
    expect(body.settings.theme).toBe('archive')
    expect(body.instances).toHaveLength(1)
    expect(body.accounts).toHaveLength(1)
    expect(body.javaRuntimes).toHaveLength(1)
    expect(body.sessions).toHaveLength(1)
    expect(body.tasks).toHaveLength(1)
    expect(ctx.paths.get().logs).toBe('C:/rhine-data/logs')
  })

  it('degrades to empty lists instead of failing when a service is missing', async () => {
    const { ctx } = createMockContext()
    delete (ctx as unknown as Record<string, unknown>).launch
    delete (ctx as unknown as Record<string, unknown>).accounts
    const app = createServerApp(ctx)
    const response = await app.request('/api/bootstrap')
    expect(response.status).toBe(200)
    const body = await response.json() as { sessions: unknown[]; accounts: unknown[] }
    expect(body.sessions).toEqual([])
    expect(body.accounts).toEqual([])
  })
})

describe('version routes', () => {
  it('hides snapshots when settings.showSnapshots is false', async () => {
    const { app, state } = setup()
    state.settings = { ...state.settings, showSnapshots: false }
    const response = await getJson(app, '/api/versions/remote')
    const body = await response.json() as { id: string; type: string }[]
    expect(body.map((version) => version.id)).toEqual(['1.21.4'])
  })

  it('shows snapshots when settings.showSnapshots is true', async () => {
    const { app, state } = setup()
    state.settings = { ...state.settings, showSnapshots: true }
    const response = await getJson(app, '/api/versions/remote')
    const body = await response.json() as { id: string }[]
    expect(body).toHaveLength(2)
  })

  it('lists installed versions', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/versions/installed')
    expect(await response.json()).toEqual(['1.21.4'])
  })

  it('starts a background install task and answers 202', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/versions/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameVersion: '1.21.4' }),
    })
    expect(response.status).toBe(202)
    const body = await response.json() as { taskId: string; title: string }
    expect(body.taskId).toMatch(/^task-/)
    expect(body.title).toContain('1.21.4')
    expect(calls.tasks[0]).toBe('run:version-install')
  })

  it('rejects an install without gameVersion', async () => {
    const { app } = setup()
    const response = await app.request('/api/versions/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { code: string; message: string }
    expect(body.code).toBe('VALIDATION_ERROR')
    expect(body.message).toContain('gameVersion')
  })
})

describe('loader routes', () => {
  it('lists loader versions for a game version', async () => {
    const { app, calls } = setup()
    const response = await getJson(app, '/api/loaders/fabric?gameVersion=1.21.4')
    expect(response.status).toBe(200)
    const body = await response.json() as { version: string }[]
    expect(body[0].version).toBe('0.16.9')
    expect(calls.loader).toContain('versions:fabric:1.21.4')
  })

  it('requires the gameVersion query parameter', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/loaders/fabric')
    expect(response.status).toBe(400)
    const body = await response.json() as { message: string }
    expect(body.message).toContain('gameVersion')
  })

  it('rejects an unknown loader kind', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/loaders/liteloader2?gameVersion=1.21.4')
    // No plugin advertises that route; this is a missing capability, not a
    // fallback multi-loader router validating a kind enum.
    expect(response.status).toBe(404)
    const body = await response.json() as { code: string }
    expect(body.code).toBe('NOT_FOUND')
  })

  it('answers an empty list for vanilla instead of hitting core', async () => {
    const { app, calls } = setup()
    const response = await getJson(app, '/api/loaders/vanilla?gameVersion=1.21.4')
    expect(await response.json()).toEqual([])
    expect(calls.loader).toHaveLength(0)
  })

  it('install returns 202 and delegates to ctx.loader', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/loaders/fabric/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameVersion: '1.21.4', loaderVersion: '0.16.9' }),
    })
    expect(response.status).toBe(202)
    expect(calls.tasks[0]).toBe('run:loader-install')
  })
})

describe('instance routes', () => {
  it('lists instances', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/instances')
    const body = await response.json() as { id: string }[]
    expect(body[0].id).toBe('archive-1')
  })

  it('returns 404 for an unknown instance', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/instances/missing')
    expect(response.status).toBe(404)
    const body = await response.json() as { code: string; message: string }
    expect(body.code).toBe('NOT_FOUND')
    expect(body.message).toContain('实例不存在')
  })

  it('creates an instance and answers 201', async () => {
    const { app, calls, state } = setup()
    const response = await app.request('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '机械动力',
        gameVersion: '1.20.1',
        loaders: [{ kind: 'forge', version: '47.2.0' }, { kind: 'vanilla' }],
        memory: { minMb: 1024, maxMb: 8192 },
        window: { width: 1280, height: 720 },
      }),
    })
    expect(response.status).toBe(201)
    const body = await response.json() as { name: string; loaders: { kind: string }[]; memory: { maxMb: number }; window: { width: number; height: number; fullscreen: boolean } }
    expect(body.name).toBe('机械动力')
    // vanilla entries are dropped: they are implied by gameVersion.
    expect(body.loaders).toEqual([{ kind: 'forge', version: '47.2.0' }])
    expect(body.memory.maxMb).toBe(8192)
    expect(body.window).toEqual({ width: 1280, height: 720, fullscreen: false })
    expect(calls.instances).toContain('create:机械动力')
    expect(state.instances).toHaveLength(2)
  })

  it('rejects an instance without a name', async () => {
    const { app } = setup()
    const response = await app.request('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ gameVersion: '1.20.1' }),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { message: string }
    expect(body.message).toContain('name')
  })

  it('rejects a heap where min exceeds max', async () => {
    const { app } = setup()
    const response = await app.request('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'x', gameVersion: '1.20.1', memory: { minMb: 4096, maxMb: 512 } }),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { message: string }
    expect(body.message).toBe('最小内存不能大于最大内存')
  })

  it('patches only the supplied fields', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/instances/archive-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '重命名档案' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { name: string; revision: number; gameVersion: string }
    expect(body.name).toBe('重命名档案')
    expect(body.gameVersion).toBe('1.21.4')
    expect(body.revision).toBe(2)
    expect(calls.instances).toContain('update:archive-1')
  })

  it('deletes an instance', async () => {
    const { app, calls, state } = setup()
    const response = await app.request('/api/instances/archive-1', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true, id: 'archive-1' })
    expect(calls.instances).toContain('remove:archive-1')
    expect(state.instances).toHaveLength(0)
  })

  it('rejects a traversal-style instance id', async () => {
    const { app } = setup()
    const response = await app.request('/api/instances/..%2Fetc/files')
    expect([400, 404]).toContain(response.status)
  })

  it('lists files under a subdirectory', async () => {
    const { app, calls } = setup()
    const response = await getJson(app, '/api/instances/archive-1/files?subdir=mods')
    expect(response.status).toBe(200)
    expect(calls.instances).toContain('files:archive-1:mods')
  })

  it('reads and writes a text file', async () => {
    const { app, calls } = setup()
    const read = await getJson(app, '/api/instances/archive-1/file?path=options.txt')
    expect(read.status).toBe(200)
    expect(await read.json()).toEqual({ path: 'options.txt', content: 'version:1.21.4\n' })

    const write = await app.request('/api/instances/archive-1/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'options.txt', content: 'fov:0.5\n' }),
    })
    expect(write.status).toBe(200)
    expect(calls.instances).toContain('writeFile:archive-1:options.txt')
  })

  it('rejects a file write without a path', async () => {
    const { app } = setup()
    const response = await app.request('/api/instances/archive-1/file', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: 'x' }),
    })
    expect(response.status).toBe(400)
  })
})

describe('mod routes', () => {
  it('lists mods', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/instances/archive-1/mods')
    const body = await response.json() as { diskName: string; meta: { id: string } }[]
    expect(body[0].diskName).toBe('sodium.jar')
    expect(body[0].meta.id).toBe('sodium')
  })

  it('toggles a mod using the explicit body value', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/instances/archive-1/mods/sodium.jar/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: false }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { enabled: boolean }
    expect(body.enabled).toBe(false)
    expect(calls.mods).toContain('toggle:archive-1:sodium.jar:false')
  })

  it('flips the state when the body is empty', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/instances/archive-1/mods/sodium.jar/toggle', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(calls.mods).toContain('toggle:archive-1:sodium.jar:false')
  })

  it('rejects a non-boolean enabled flag', async () => {
    const { app } = setup()
    const response = await app.request('/api/instances/archive-1/mods/sodium.jar/toggle', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: 'yes' }),
    })
    expect(response.status).toBe(400)
  })

  it('returns 404 when toggling an unknown mod', async () => {
    const { app } = setup()
    const response = await app.request('/api/instances/archive-1/mods/absent.jar/toggle', { method: 'POST' })
    expect(response.status).toBe(404)
  })

  it('starts a mod install task', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/instances/archive-1/mods', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.invalid/a.jar', fileName: 'a.jar' }),
    })
    expect(response.status).toBe(202)
    expect(calls.tasks[0]).toBe('run:mod-install')
  })
})

describe('diagnostics route', () => {
  it('answers an empty list when the optional service is absent', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/instances/archive-1/diagnostics')
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([])
  })

  it('delegates to ctx.diagnostics when present', async () => {
    const { app } = setup({
      diagnostics: {
        analyze: async (id: string) => [{ level: 'error' as const, message: `${id} 崩溃`, hint: '检查模组' }],
      },
    })
    const response = await getJson(app, '/api/instances/archive-1/diagnostics')
    const body = await response.json() as { level: string; message: string; hint: string }[]
    expect(body[0]).toEqual({ level: 'error', message: 'archive-1 崩溃', hint: '检查模组' })
  })
})

describe('market routes', () => {
  it('searches with the parsed filters', async () => {
    const { app, calls } = setup()
    const response = await getJson(app, '/api/market/search?source=modrinth&query=sodium&projectType=mod&limit=10&sort=downloads')
    expect(response.status).toBe(200)
    const body = await response.json() as { total: number; limit: number; hits: { title: string }[] }
    expect(body.total).toBe(1)
    expect(body.limit).toBe(10)
    expect(body.hits[0].title).toBe('Sodium')
    expect(calls.market[0]).toBe('search:modrinth:sodium')
  })

  it('rejects an unknown source', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/market/search?source=curse&query=x')
    expect(response.status).toBe(400)
  })

  it('rejects a limit above the ceiling', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/market/search?source=modrinth&query=x&limit=500')
    expect(response.status).toBe(400)
  })

  it('lists project versions', async () => {
    const { app, calls } = setup()
    const response = await getJson(app, '/api/market/curseforge/AANobbMI/versions?gameVersion=1.21.4&loader=fabric')
    expect(response.status).toBe(200)
    const body = await response.json() as { id: string }[]
    expect(body[0].id).toBe('ver-1')
    expect(calls.market).toContain('versions:curseforge:AANobbMI')
  })

  it('starts a market install task after validating the version payload', async () => {
    const { app } = setup()
    const response = await app.request('/api/market/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        instanceId: 'archive-1',
        version: {
          source: 'modrinth',
          id: 'ver-1',
          projectId: 'AANobbMI',
          name: 'Sodium 0.6.0',
          file: { url: 'https://example.invalid/sodium.jar', fileName: 'sodium.jar', size: 1024 },
        },
      }),
    })
    expect(response.status).toBe(202)
  })

  it('rejects a market install payload without file.url', async () => {
    const { app } = setup()
    const response = await app.request('/api/market/install', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'archive-1', version: { source: 'modrinth', id: 'x', file: { fileName: 'a.jar' } } }),
    })
    expect(response.status).toBe(400)
  })
})

describe('launch routes', () => {
  it('starts a session', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'archive-1', accountId: 'offline-steve', memoryMb: 4096 }),
    })
    expect(response.status).toBe(202)
    const body = await response.json() as { id: string; status: string }
    expect(body.status).toBe('running')
    expect(calls.launch).toContain('launch:archive-1')
  })

  it('rejects a launch without an account', async () => {
    const { app } = setup()
    const response = await app.request('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'archive-1' }),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { message: string }
    expect(body.message).toContain('accountId')
  })

  it('builds a command without launching', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/launch/build', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ instanceId: 'archive-1', accountId: 'offline-steve' }),
    })
    const body = await response.json() as { command: string[]; cwd: string; mainClass: string }
    expect(body.mainClass).toBe('net.minecraft.client.main.Main')
    expect(calls.launch).toContain('build:archive-1')
  })

  it('lists sessions and their log tail', async () => {
    const { app, calls } = setup()
    const sessions = await getJson(app, '/api/launch/sessions')
    expect((await sessions.json() as unknown[]).length).toBe(1)

    const log = await getJson(app, '/api/launch/sessions/session-1/log?tail=50')
    const body = await log.json() as { sessionId: string; lines: { message: string }[] }
    expect(body.sessionId).toBe('session-1')
    expect(body.lines[0].message).toContain('Starting')
    expect(calls.launch).toContain('log:session-1:50')
  })

  it('404s an unknown session log', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/launch/sessions/nope/log')
    expect(response.status).toBe(404)
  })

  it('kills a session', async () => {
    const { app, calls, state } = setup()
    const response = await app.request('/api/launch/sessions/session-1/kill', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(calls.launch).toContain('kill:session-1')
    expect(state.sessions[0].status).toBe('stopped')
  })
})

describe('account routes', () => {
  it('lists accounts', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/accounts')
    const body = await response.json() as { name: string }[]
    expect(body[0].name).toBe('Steve')
  })

  it('adds an offline account and validates the name', async () => {
    const { app, calls } = setup()
    const okResponse = await app.request('/api/accounts/offline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Alex_99' }),
    })
    expect(okResponse.status).toBe(201)
    expect(calls.accounts).toContain('offline:Alex_99')

    const bad = await app.request('/api/accounts/offline', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '非法 名字' }),
    })
    expect(bad.status).toBe(400)
    const body = await bad.json() as { message: string }
    expect(body.message).toContain('字母')
  })

  it('starts the Microsoft device-code flow', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/accounts/microsoft/start', { method: 'POST' })
    expect(response.status).toBe(200)
    const body = await response.json() as { userCode: string; verificationUri: string }
    expect(body.userCode).toBe('ABCD-EFGH')
    expect(body.verificationUri).toContain('microsoft')
    expect(calls.accounts).toContain('beginMicrosoft')
  })

  it('removes an account', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/accounts/offline-steve', { method: 'DELETE' })
    expect(response.status).toBe(200)
    expect(calls.accounts).toContain('remove:offline-steve')
  })
})

describe('settings routes', () => {
  it('returns settings', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/settings')
    const body = await response.json() as { theme: string; language: string }
    expect(body.theme).toBe('archive')
    expect(body.language).toBe('zh-CN')
  })

  it('applies a partial patch', async () => {
    const { app, state } = setup()
    const response = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ showSnapshots: true, concurrency: 16 }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { showSnapshots: boolean; concurrency: number }
    expect(body.showSnapshots).toBe(true)
    expect(body.concurrency).toBe(16)
    expect(state.settings.concurrency).toBe(16)
  })

  it('rejects an unknown settings key', async () => {
    const { app } = setup()
    const response = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nope: 1 }),
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { message: string }
    expect(body.message).toContain('nope')
  })

  it('rejects an out-of-range concurrency', async () => {
    const { app } = setup()
    const response = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency: 999 }),
    })
    expect(response.status).toBe(400)
  })
})

describe('task and java routes', () => {
  it('lists tasks and cancels one', async () => {
    const { app, calls } = setup()
    const list = await getJson(app, '/api/tasks')
    expect((await list.json() as unknown[]).length).toBe(1)

    const cancel = await app.request('/api/tasks/task-1/cancel', { method: 'POST' })
    expect(cancel.status).toBe(200)
    expect(calls.tasks).toContain('cancel:task-1')
  })

  it('404s cancelling an unknown task', async () => {
    const { app } = setup()
    const response = await app.request('/api/tasks/ghost/cancel', { method: 'POST' })
    expect(response.status).toBe(404)
  })

  it('returns cached java runtimes', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/java')
    const body = await response.json() as { majorVersion: number }[]
    expect(body[0].majorVersion).toBe(21)
  })

  it('rescans java runtimes', async () => {
    const { app, calls } = setup()
    const response = await app.request('/api/java/scan', { method: 'POST' })
    expect(response.status).toBe(200)
    expect(calls.java).toContain('scan')
  })
})

describe('error envelope', () => {
  it('returns JSON 404 for an unknown API route', async () => {
    const { app } = setup()
    const response = await getJson(app, '/api/nope')
    expect(response.status).toBe(404)
    const body = await response.json() as { code: string; message: string }
    expect(body.code).toBe('NOT_FOUND')
    expect(body.message).toContain('/api/nope')
  })

  it('maps a thrown domain error to 500 with a JSON body', async () => {
    const { ctx } = createMockContext()
    // Make a service explode to prove the onError hook maps it to the envelope.
    ;(ctx as unknown as Record<string, unknown>).instances = {
      list() { throw new Error('磁盘故障') },
    }
    const app = createServerApp(ctx)
    const response = await app.request('/api/instances')
    expect(response.status).toBe(500)
    const body = await response.json() as { code: string; message: string }
    expect(body.code).toBe('INTERNAL_ERROR')
    expect(body.message).toBe('磁盘故障')
  })

  it('maps a NotFoundError to 404', async () => {
    const { ctx } = createMockContext()
    ;(ctx as unknown as Record<string, unknown>).instances = {
      list() {
        const error = new Error('没有这个实例')
        error.name = 'NotFoundError'
        throw error
      },
    }
    const app = createServerApp(ctx)
    const response = await app.request('/api/instances')
    expect(response.status).toBe(404)
  })

  it('answers 503 when a required service is missing', async () => {
    const { ctx } = createMockContext()
    await ctx.features.settled()
    await ctx.features.disable('version.installed')
    const app = createServerApp(ctx)
    const response = await app.request('/api/versions/installed')
    expect(response.status).toBe(503)
    const body = await response.json() as { code: string; message: string }
    expect(body.code).toBe('PLUGIN_UNAVAILABLE')
    expect(body.message).toContain('version.installed')
  })

  it('rejects malformed JSON with a Chinese message', async () => {
    const { app } = setup()
    const response = await app.request('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{not json',
    })
    expect(response.status).toBe(400)
    const body = await response.json() as { message: string }
    expect(body.message).toContain('JSON')
  })
})

describe('static hosting', () => {
  /** An app whose web dist directory definitely does not exist. */
  function unbuiltApp() {
    const mock = createMockContext()
    return createServerApp(mock.ctx, { webDist: 'C:/definitely/not/built' })
  }

  it('serves the placeholder page when the client is not built', async () => {
    const response = await unbuiltApp().request('/')
    expect(response.status).toBe(200)
    const html = await response.text()
    expect(html).toContain('前端资源尚未构建')
    expect(html).toContain('pnpm --filter @rhine/web build')
  })

  it('serves the placeholder for a deep SPA route too', async () => {
    const response = await unbuiltApp().request('/archive/archive-1')
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('前端资源尚未构建')
  })

  it('serves the built client entry point when dist exists', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-app-dist-'))
    await writeFile(join(dir, ENTRY_DOCUMENT), '<!doctype html><title>Rhine UI</title>', 'utf8')
    try {
      const mock = createMockContext()
      const app = createServerApp(mock.ctx, { webDist: dir })
      const root = await app.request('/')
      expect(root.status).toBe(200)
      expect(await root.text()).toContain('Rhine UI')
      // Deep links fall back to the SPA entry instead of 404.
      const deep = await app.request('/instances/archive-1')
      expect(deep.status).toBe(200)
      expect(await deep.text()).toContain('Rhine UI')
      // An absent asset is never returned as successful HTML (fonts would fail silently).
      const missingFont=await app.request('/fonts/missing.woff2')
      expect(missingFont.status).toBe(404)
      expect(missingFont.headers.get('content-type')).not.toContain('text/html')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('answers JSON 404 for an unknown API path even when dist exists', async () => {
    const mock = createMockContext()
    const app = createServerApp(mock.ctx)
    const response = await app.request('/api/definitely-missing')
    expect(response.status).toBe(404)
    expect((await response.json() as { code: string }).code).toBe('NOT_FOUND')
  })
})

describe('mock context sanity', () => {
  it('records instances created by the fixture', async () => {
    const mock = createMockContext()
    expect(mock.ctx.instances.list()).toEqual([makeInstance()])
  })
})