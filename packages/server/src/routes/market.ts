/**
 * Marketplace routes: Modrinth and CurseForge search, version listing and
 * one-click installation into an instance.
 */
import { Hono } from 'hono'
import { ApiError, optionalString, readJsonObject, requiredString } from '../http.ts'
import { MARKET_SOURCES, parseMarketSearch, parseMarketVersion } from '../payloads.ts'
import { service } from '../services.ts'
import { accepted, type Ctx } from './shared.ts'

/** Validate a `:source` path parameter. */
export function parseSource(raw: string | undefined): 'modrinth' | 'curseforge' {
  if (!raw || !(MARKET_SOURCES as readonly string[]).includes(raw)) {
    throw ApiError.validation(`未知的市场来源：${raw ?? ''}`, `可选值：${MARKET_SOURCES.join(' / ')}`)
  }
  return raw as 'modrinth' | 'curseforge'
}

/** Routes mounted under `/api/market`. */
export function marketRoutes(ctx: Ctx): Hono {
  const app = new Hono()

  app.get('/search', async (c) => {
    const input = parseMarketSearch(new URL(c.req.url))
    return c.json(await service(ctx, 'market').search(input))
  })

  app.get('/:source/project/:id', async (c) => {
    const source = parseSource(c.req.param('source'))
    const id = requiredString({ id: c.req.param('id') }, 'id', { label: '项目 id', max: 128 })
    return c.json(await service(ctx, 'market').project(source, id))
  })

  app.get('/:source/:id/versions', async (c) => {
    const source = parseSource(c.req.param('source'))
    const projectId = requiredString({ id: c.req.param('id') }, 'id', { label: '项目 id', max: 128 })
    const filter: { gameVersion?: string; loader?: string } = {}
    const gameVersion = optionalString({ v: c.req.query('gameVersion') }, 'v')
    if (gameVersion) filter.gameVersion = gameVersion
    const loader = optionalString({ v: c.req.query('loader') }, 'v')
    if (loader) filter.loader = loader
    return c.json(await service(ctx, 'market').versions(source, projectId, filter))
  })

  app.post('/install', async (c) => {
    const body = await readJsonObject(c.req.raw, '安装请求')
    const instanceId = requiredString(body, 'instanceId', { label: 'instanceId', max: 128 })
    if (!body.version) throw ApiError.validation('缺少必填字段：version')
    const version = parseMarketVersion(body.version)
    const market = service(ctx, 'market')
    const tasks = service(ctx, 'tasks')
    const title = `安装 ${version.name || version.file.fileName}`
    const taskId = tasks.run(title, 'market-install', async (handle) => {
      await market.install(instanceId, version, handle)
    })
    return accepted(c, taskId, title)
  })

  return app
}

/** Guard used by callers that need a source before doing any work. */
export function assertSource(raw: string | undefined): asserts raw is 'modrinth' | 'curseforge' {
  if (!raw || !(MARKET_SOURCES as readonly string[]).includes(raw)) {
    throw ApiError.validation(`未知的市场来源：${raw ?? ''}`)
  }
}