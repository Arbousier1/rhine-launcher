/**
 * Launcher metadata routes: bootstrap, versions, loaders, health.
 *
 * Everything here is a thin projection of `ctx.meta` / `ctx.loader`; the
 * server owns no caching and no version arithmetic of its own.
 */
import { Hono } from 'hono'
import type { LoaderKind, RemoteVersion } from '@rhine/core'
import { buildBootstrap } from '../bootstrap.ts'
import { APP_NAME, APP_VERSION } from '../constants.ts'
import { ApiError, requiredString, readJsonObject } from '../http.ts'
import { LOADER_KINDS } from '../payloads.ts'
import { service } from '../services.ts'
import { accepted, ok, type Ctx } from './shared.ts'

/** Routes mounted under `/api`. */
export function metaRoutes(ctx: Ctx): Hono {
  const app = new Hono()

  app.get('/health', (c) => {
    const mounted = {
      paths: !!ctx.paths,
      settings: !!ctx.settings,
      instances: !!ctx.instances,
      meta: !!ctx.meta,
      loader: !!ctx.loader,
      java: !!ctx.java,
      accounts: !!ctx.accounts,
      mods: !!ctx.mods,
      market: !!ctx.market,
      launch: !!ctx.launch,
      tasks: !!ctx.tasks,
    }
    return c.json({
      ok: Object.values(mounted).every(Boolean),
      app: APP_NAME,
      version: APP_VERSION,
      pid: process.pid,
      platform: process.platform,
      node: process.versions.node,
      uptimeMs: Math.round(process.uptime() * 1000),
      services: mounted,
    })
  })

  app.get('/bootstrap', async (c) => c.json(await buildBootstrap(ctx)))

  app.get('/versions/remote', async (c) => {
    const meta = service(ctx, 'meta')
    const showSnapshots = ctx.settings ? ctx.settings.get().showSnapshots : true
    const versions = await meta.remoteVersions()
    // Snapshots are opt-in: the archive view defaults to release builds only.
    const list: RemoteVersion[] = showSnapshots
      ? versions
      : versions.filter((version) => version.type === 'release')
    return c.json(list)
  })

  app.get('/versions/installed', async (c) => c.json(await service(ctx, 'meta').installed()))

  app.post('/versions/install', async (c) => {
    const body = await readJsonObject(c.req.raw, '安装请求')
    const gameVersion = requiredString(body, 'gameVersion', { label: 'gameVersion', max: 64 })
    const meta = service(ctx, 'meta')
    const tasks = service(ctx, 'tasks')
    const taskId = tasks.run(`安装 Minecraft ${gameVersion}`, 'version-install', async (handle) => {
      await meta.install(gameVersion, handle)
    })
    return accepted(c, taskId, `安装 Minecraft ${gameVersion}`)
  })

  // `/versions/:gameVersion/loaders` lists loader attachments already present.
  app.get('/versions/:gameVersion/loaders', async (c) => {
    const gameVersion = c.req.param('gameVersion')
    return c.json(await service(ctx, 'loader').detect(gameVersion))
  })

  app.get('/loaders/:kind', async (c) => {
    const kind = parseLoaderKind(c.req.param('kind'))
    const gameVersion = (c.req.query('gameVersion') ?? '').trim()
    if (!gameVersion) throw ApiError.validation('缺少查询参数 gameVersion')
    if (kind === 'vanilla') return c.json([])
    return c.json(await service(ctx, 'loader').versions(kind, gameVersion))
  })

  app.post('/loaders/:kind/install', async (c) => {
    const kind = parseLoaderKind(c.req.param('kind'))
    if (kind === 'vanilla') throw ApiError.validation('vanilla 无需安装加载器，请使用 /api/versions/install')
    const body = await readJsonObject(c.req.raw, '安装请求')
    const gameVersion = requiredString(body, 'gameVersion', { label: 'gameVersion', max: 64 })
    const loaderVersion = requiredString(body, 'loaderVersion', { label: 'loaderVersion', max: 64 })
    const loader = service(ctx, 'loader')
    const tasks = service(ctx, 'tasks')
    const title = `安装 ${kind} ${loaderVersion}（Minecraft ${gameVersion}）`
    const taskId = tasks.run(title, 'loader-install', async (handle) => {
      await loader.install(kind, gameVersion, loaderVersion, handle)
    })
    return accepted(c, taskId, title)
  })

  return app
}

/** Validate a `:kind` path segment against the shared loader enum. */
export function parseLoaderKind(raw: string): LoaderKind {
  if (!(LOADER_KINDS as readonly string[]).includes(raw)) {
    throw ApiError.validation(`未知的加载器类型：${raw}`, `可选值：${LOADER_KINDS.join(' / ')}`)
  }
  return raw as LoaderKind
}
