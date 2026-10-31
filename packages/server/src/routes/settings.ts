/**
 * Settings, tasks, Java runtime and download helper routes.
 */
import { Hono } from 'hono'
import { ApiError, readJsonObject, requiredString } from '../http.ts'
import { parseSettingsPatch } from '../payloads.ts'
import { service } from '../services.ts'
import { accepted, ok, type Ctx } from './shared.ts'

/** Routes mounted under `/api` for settings, tasks and java. */
export function settingsRoutes(ctx: Ctx): Hono {
  const app = new Hono()

  app.get('/settings', (c) => c.json(service(ctx, 'settings').get()))

  app.patch('/settings', async (c) => {
    const body = await readJsonObject(c.req.raw, '设置')
    const patch = parseSettingsPatch(body)
    return c.json(await service(ctx, 'settings').update(patch))
  })

  app.get('/tasks', (c) => c.json(service(ctx, 'tasks').list()))

  app.get('/tasks/:id', (c) => {
    const id = c.req.param('id')
    const task = service(ctx, 'tasks').get(id)
    if (!task) throw ApiError.notFound(`任务不存在：${id}`)
    return c.json(task)
  })

  app.post('/tasks/:id/cancel', (c) => {
    const id = c.req.param('id')
    if (!service(ctx, 'tasks').cancel(id)) throw ApiError.notFound(`任务不存在或已结束：${id}`)
    return ok(c, id)
  })

  app.get('/java', (c) => c.json(service(ctx, 'java').cached()))

  app.post('/java/scan', async (c) => c.json(await service(ctx, 'java').scan()))

  app.post('/java/install', async (c) => {
    const body = await readJsonObject(c.req.raw, '安装请求')
    const component = requiredString(body, 'component', { label: 'component', max: 64 })
    const java = service(ctx, 'java')
    const tasks = service(ctx, 'tasks')
    const title = `安装 Java 运行时 ${component}`
    const taskId = tasks.run(title, 'java-install', async (handle) => {
      await java.install(component, handle)
    })
    return accepted(c, taskId, title)
  })

  return app
}
