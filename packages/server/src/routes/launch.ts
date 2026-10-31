/**
 * Launch routes: start a game session, inspect sessions and their logs, kill.
 */
import { Hono } from 'hono'
import type { LaunchSession } from '@rhine/core'
import { ApiError, queryInteger, readJsonObject } from '../http.ts'
import { parseLaunchRequest } from '../payloads.ts'
import { service } from '../services.ts'
import { ok, type Ctx } from './shared.ts'

/** Default number of log lines returned by the tail endpoint. */
export const DEFAULT_LOG_TAIL = 200

/** Routes mounted under `/api/launch`. */
export function launchRoutes(ctx: Ctx): Hono {
  const app = new Hono()

  app.post('/', async (c) => {
    const body = await readJsonObject(c.req.raw, '启动请求')
    const request = parseLaunchRequest(body)
    const session: LaunchSession = await service(ctx, 'launch').launch(request)
    return c.json(session, 202)
  })

  // Dry run: build the argument vector without starting the game.
  app.post('/build', async (c) => {
    const body = await readJsonObject(c.req.raw, '启动请求')
    const request = parseLaunchRequest(body)
    return c.json(await service(ctx, 'launch').buildCommand(request))
  })

  app.get('/sessions', (c) => c.json(service(ctx, 'launch').sessions()))

  app.get('/sessions/:id', (c) => {
    const id = c.req.param('id')
    const session = service(ctx, 'launch').session(id)
    if (!session) throw ApiError.notFound(`启动会话不存在：${id}`)
    return c.json(session)
  })

  app.get('/sessions/:id/log', (c) => {
    const id = c.req.param('id')
    const tail = queryInteger(c.req.query('tail'), 'tail', { min: 1, max: 5000, fallback: DEFAULT_LOG_TAIL })
    if (!service(ctx, 'launch').session(id)) throw ApiError.notFound(`启动会话不存在：${id}`)
    return c.json({ sessionId: id, lines: service(ctx, 'launch').log(id, tail) })
  })

  app.post('/sessions/:id/kill', async (c) => {
    const id = c.req.param('id')
    if (!service(ctx, 'launch').session(id)) throw ApiError.notFound(`启动会话不存在：${id}`)
    await service(ctx, 'launch').kill(id)
    return ok(c, id)
  })

  return app
}
