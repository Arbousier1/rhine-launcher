/**
 * End-to-end integration: the real Cordis context, the real core services on a
 * temporary data directory, and the real Hono app.
 *
 * Nothing is mocked here — instances really land on disk, the bus really
 * broadcasts, and `app.request()` drives the same code path the browser hits.
 * Only the plugins that exist in `@rhine/core` today are installed.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { RhContext } from '@rhine/core'
import { createLauncherContext } from '@rhine/core'
// Capability plugins are imported by path so the test keeps working while the
// core barrel file grows.
import { createServerApp } from '../src/app.ts'
import { buildBootstrap } from '../src/bootstrap.ts'

let root = ''
let ctx: RhContext
let previousHome: string | undefined


beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'rhine-int-'))
  // `ctx.settings` persists to `defaultDataDir()`, so point the launcher home at
  // the temporary directory: the test must never touch the developer's real
  // `%APPDATA%/RhineLauncher/launcher.json`.
  previousHome = process.env.RHINE_HOME
  process.env.RHINE_HOME = root
  ctx = await createLauncherContext({ root })
  await ctx.paths.ensure()
})

afterAll(async () => {
  if (previousHome === undefined) delete process.env.RHINE_HOME
  else process.env.RHINE_HOME = previousHome
  await ctx?.features.dispose()
  if (root) await rm(root, { recursive: true, force: true })
})

describe('integration: real core services behind the HTTP shell', () => {
  it('creates the directory skeleton under the configured root', () => {
    expect(ctx.paths.get().root).toBe(root)
    expect(existsSync(ctx.paths.get().instances)).toBe(true)
    expect(existsSync(ctx.paths.get().logs)).toBe(true)
    expect(existsSync(ctx.paths.get().java)).toBe(true)
  })

  it('reports the real pid and paths in the bootstrap snapshot', async () => {
    const bootstrap = await buildBootstrap(ctx)
    expect(bootstrap.paths.root).toBe(root)
    expect(bootstrap.app.pid).toBe(process.pid)
    expect(bootstrap.app.platform).toBe(process.platform)
    expect(bootstrap.settings.dataDir).toBeNull()
    expect(typeof bootstrap.settings.concurrency).toBe('number')
    expect(Array.isArray(bootstrap.instances)).toBe(true)
  })

  it('creates, reads, patches and deletes a real instance', async () => {
    const app = createServerApp(ctx)

    const created = await app.request('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: '集成测试档案',
        gameVersion: '1.20.1',
        loaders: [{ kind: 'fabric', version: '0.16.9' }],
        memory: { minMb: 1024, maxMb: 2048 },
      }),
    })
    expect(created.status).toBe(201)
    const instance = await created.json() as { id: string; name: string; path: string }
    expect(instance.name).toBe('集成测试档案')
    // The real service wrote instance.json to disk.
    expect(existsSync(join(instance.path, 'instance.json'))).toBe(true)
    const stored = JSON.parse(await readFile(join(instance.path, 'instance.json'), 'utf8')) as { name: string }
    expect(stored.name).toBe('集成测试档案')

    const list = await app.request('/api/instances')
    const items = await list.json() as { id: string }[]
    expect(items.some((item) => item.id === instance.id)).toBe(true)

    const patched = await app.request(`/api/instances/${instance.id}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ memory: { minMb: 2048, maxMb: 4096 } }),
    })
    expect(patched.status).toBe(200)
    const after = await patched.json() as { memory: { maxMb: number }; revision: number }
    expect(after.memory.maxMb).toBe(4096)
    expect(after.revision).toBeGreaterThan(1)

    const removed = await app.request(`/api/instances/${instance.id}`, { method: 'DELETE' })
    expect(removed.status).toBe(200)
    const missing = await app.request(`/api/instances/${instance.id}`)
    expect(missing.status).toBe(404)
  })

  it('round-trips options.txt through the file endpoints', async () => {
    const app = createServerApp(ctx)
    const created = await app.request('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '文件测试', gameVersion: '1.20.1' }),
    })
    const instance = await created.json() as { id: string; path: string }

    const read = await app.request(`/api/instances/${instance.id}/file?path=options.txt`)
    expect(read.status).toBe(200)
    const body = await read.json() as { content: string }
    // Core seeds a fresh instance with a vanilla style options.txt.
    expect(body.content.length).toBeGreaterThan(0)
    expect(body.content).toContain('fov:')

    const write = await app.request(`/api/instances/${instance.id}/file`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: 'options.txt', content: 'fov:0.5\n' }),
    })
    expect(write.status).toBe(200)
    expect(await readFile(join(instance.path, 'options.txt'), 'utf8')).toBe('fov:0.5\n')
  })

  it('lists real files in the instance directory', async () => {
    const app = createServerApp(ctx)
    const created = await app.request('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '目录测试', gameVersion: '1.20.1' }),
    })
    const instance = await created.json() as { id: string }
    const response = await app.request(`/api/instances/${instance.id}/files?subdir=mods`)
    expect(response.status).toBe(200)
    expect(Array.isArray(await response.json())).toBe(true)
  })

  it('persists a settings patch through the real settings service', async () => {
    const app = createServerApp(ctx)
    const response = await app.request('/api/settings', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ concurrency: 4, theme: 'midnight' }),
    })
    expect(response.status).toBe(200)
    const body = await response.json() as { concurrency: number; theme: string }
    expect(body.concurrency).toBe(4)
    expect(body.theme).toBe('midnight')
    expect(ctx.settings.get().theme).toBe('midnight')
    // The service writes launcher.json on the real data directory.
    expect(existsSync(join(root, 'launcher.json'))).toBe(true)
  })

  it('lists empty tasks and 404s an unknown cancel on the real service', async () => {
    const app = createServerApp(ctx)
    const list = await app.request('/api/tasks')
    expect(Array.isArray(await list.json())).toBe(true)
    const cancel = await app.request('/api/tasks/nope/cancel', { method: 'POST' })
    expect(cancel.status).toBe(404)
  })

  it('broadcasts real bus events emitted by core', async () => {
    const app = createServerApp(ctx)
    const received: unknown[] = []
    const unsubscribe = ctx.bus.subscribe((event) => received.push(event))

    // Creating an instance makes the real service emit on the bus.
    const created = await app.request('/api/instances', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: '广播测试', gameVersion: '1.20.1' }),
    })
    expect(created.status).toBe(201)
    unsubscribe()
    expect(received.some((event) => (event as { type: string }).type === 'instance')).toBe(true)
  })

  it('returns 503 only for a disabled function while siblings remain available', async () => {
    const app = createServerApp(ctx)
    await ctx.features.disable('version.installed')
    const response = await app.request('/api/versions/installed')
    expect(response.status).toBe(503)
    const body = await response.json() as { code: string; message: string }
    expect(body.code).toBe('PLUGIN_UNAVAILABLE')
    expect(body.message).toContain('version.installed')
    expect((await app.request('/api/instances')).status).toBe(200)
    await ctx.features.enable('version.installed')
    expect((await app.request('/api/versions/installed')).status).toBe(200)
  })

  it('serves the bootstrap over HTTP with the real instances', async () => {
    const app = createServerApp(ctx)
    const response = await app.request('/api/bootstrap')
    expect(response.status).toBe(200)
    const bootstrap = await response.json() as { instances: { name: string }[]; paths: { root: string } }
    expect(bootstrap.paths.root).toBe(root)
    expect(bootstrap.instances.length).toBeGreaterThan(0)
  })
})
