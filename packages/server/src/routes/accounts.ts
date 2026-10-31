/**
 * Account routes: list, offline sign-in and the Microsoft device-code flow.
 */
import { Hono } from 'hono'
import { ApiError, readJsonObject, requiredString } from '../http.ts'
import { service } from '../services.ts'
import { ok, type Ctx } from './shared.ts'

/** Max offline player name length accepted from the UI. */
export const MAX_PLAYER_NAME = 16

/** Routes mounted under `/api/accounts`. */
export function accountRoutes(ctx: Ctx): Hono {
  const app = new Hono()

  app.get('/', (c) => c.json(service(ctx, 'accounts').list()))

  app.get('/:id', (c) => {
    const id = c.req.param('id')
    const account = service(ctx, 'accounts').get(id)
    if (!account) throw ApiError.notFound(`账号不存在：${id}`)
    return c.json(account)
  })

  app.post('/offline', async (c) => {
    const body = await readJsonObject(c.req.raw, '离线账号请求')
    const raw = requiredString(body, 'name', { label: '玩家名', max: MAX_PLAYER_NAME })
    // Mojang's own rule for offline names; keeps skins and commands predictable.
    if (!/^[A-Za-z0-9_]{1,16}$/.test(raw)) {
      throw ApiError.validation('玩家名只能包含字母、数字和下划线，长度 1-16 位')
    }
    return c.json(await service(ctx, 'accounts').addOffline(raw), 201)
  })

  app.post('/authlib-injector', async (c) => {
    const body = await readJsonObject(c.req.raw, '外置登录请求')
    const authServerUrl = requiredString(body, 'authServerUrl', { label: '认证服务器地址' })
    const username = requiredString(body, 'username', { label: '用户名' })
    const password = requiredString(body, 'password', { label: '密码' })
    return c.json(await service(ctx, 'accounts').addAuthlibInjector(authServerUrl, username, password), 201)
  })

  app.delete('/:id', async (c) => {
    const id = c.req.param('id')
    await service(ctx, 'accounts').remove(id)
    return ok(c, id)
  })

  app.post('/microsoft/start', async (c) => {
    return c.json(await service(ctx, 'accounts').beginMicrosoft())
  })

  app.post('/microsoft/complete', async (c) => {
    // An empty body is normal here: the pending flow is kept in the service.
    await c.req.raw.text().catch(() => '')
    return c.json(await service(ctx, 'accounts').completeMicrosoft())
  })

  app.post('/:id/refresh', async (c) => {
    const id = c.req.param('id')
    return c.json(await service(ctx, 'accounts').refresh(id))
  })

  app.post('/:id/authorize', async (c) => {
    const id = c.req.param('id')
    return c.json(await service(ctx, 'accounts').authorize(id))
  })

  return app
}
