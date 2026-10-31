/**
 * Instance routes: CRUD, file browsing, mods and crash diagnostics.
 *
 * All path handling, atomic writes and jar parsing happen in core; this module
 * only validates the request and shapes the response.
 */
import { Hono } from 'hono'
import type { Instance, ModFile } from '@rhine/core'
import { copyFile, mkdir, stat } from 'node:fs/promises'
import { basename, isAbsolute, join, resolve } from 'node:path'
import { ApiError, optionalString, readJsonObject, requiredString } from '../http.ts'
import { parseInstanceConfig, parseInstancePatch } from '../payloads.ts'
import { diagnosticsOf, service } from '../services.ts'
import { accepted, ok, type Ctx } from './shared.ts'

/**
 * Characters core's `sanitizeId` rewrites, plus traversal.
 *
 * Instance ids double as directory names and are allowed to be Chinese (the
 * launcher derives them from the archive name), so this deliberately mirrors
 * `sanitizeId` in `@rhine/core` instead of restricting to ASCII.
 */
const UNSAFE_ID = /[\\/:*?"<>|]/

/**
 * Validate a path parameter used as an instance id.
 *
 * @throws ApiError 400 when the id is empty, contains a path separator or a
 *   Windows-reserved character, or tries to traverse upwards.
 */
export function parseInstanceId(raw: string | undefined): string {
  if (!raw) throw ApiError.validation('缺少实例 id')
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    throw ApiError.validation('实例 id 编码非法')
  }
  if (decoded === '.' || decoded === '..' || decoded.includes('..')) {
    throw ApiError.validation('实例 id 含有非法的路径片段')
  }
  if (UNSAFE_ID.test(decoded)) {
    throw ApiError.validation('实例 id 含有非法字符', '不能包含 \\ / : * ? " < > |')
  }
  return decoded
}

/** Routes mounted under `/api/instances`. */
export function instanceRoutes(ctx: Ctx): Hono {
  const app = new Hono()

  app.get('/', (c) => c.json(service(ctx, 'instances').list()))

  app.get('/:id', (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const instance = service(ctx, 'instances').get(id)
    if (!instance) throw ApiError.notFound(`实例不存在：${id}`)
    return c.json(instance)
  })

  app.post('/', async (c) => {
    const body = await readJsonObject(c.req.raw, '实例配置')
    const config = parseInstanceConfig(body)
    const instance: Instance = await service(ctx, 'instances').create(config)
    return c.json(instance, 201)
  })

  app.post('/import-modpack', async (c) => {
    const body = await readJsonObject(c.req.raw, '导入整合包请求')
    const path = requiredString(body, 'path', { label: '整合包路径' })
    const name = optionalString(body, 'name')
    const taskId = service(ctx, 'tasks').run('导入整合包', 'import-modpack', async (handle) => {
      return service(ctx, 'instances').importModpack(path, name, handle)
    })
    return c.json({ taskId }, 202)
  })

  app.patch('/:id', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const body = await readJsonObject(c.req.raw, '实例配置')
    const patch = parseInstancePatch(body)
    return c.json(await service(ctx, 'instances').update(id, patch))
  })

  app.delete('/:id', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const deleteFiles = c.req.query('deleteFiles')
    await service(ctx, 'instances').remove(id, { deleteFiles: deleteFiles !== 'false' })
    return ok(c, id)
  })

  app.post('/:id/duplicate', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const body = await readJsonObject(c.req.raw, '复制请求')
    const source = service(ctx, 'instances').get(id)
    if (!source) throw ApiError.notFound(`实例不存在：${id}`)
    const name = optionalString(body, 'name') ?? `${source.name} 的副本`
    return c.json(await service(ctx, 'instances').duplicate(id, name), 201)
  })

  app.get('/:id/files', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const subdir = optionalString({ subdir: c.req.query('subdir') }, 'subdir', { trim: false })
    return c.json(await service(ctx, 'instances').files(id, subdir))
  })

  // Read / write / delete one small text file (options.txt, servers.dat, ...).
  app.get('/:id/file', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const relative = requireFileQuery(c.req.query('path'))
    const content = await service(ctx, 'instances').readFile(id, relative)
    return c.json({ path: relative, content })
  })

  app.put('/:id/file', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const body = await readJsonObject(c.req.raw, '文件内容')
    const relative = requiredString(body, 'path', { label: 'path', max: 512 })
    if (typeof body.content !== 'string') throw ApiError.validation('字段 content 必须是字符串')
    await service(ctx, 'instances').writeFile(id, relative, body.content)
    return ok(c, id)
  })

  app.delete('/:id/file', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const relative = requireFileQuery(c.req.query('path'))
    await service(ctx, 'instances').deleteFile(id, relative)
    return ok(c, id)
  })

  app.get('/:id/mods', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    return c.json(await service(ctx, 'mods').list(id))
  })

  app.post('/:id/mods', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const body = await readJsonObject(c.req.raw, '模组安装请求')
    const url = requiredString(body, 'url', { label: 'url', max: 2048 })
    const fileName = requiredString(body, 'fileName', { label: 'fileName', max: 255 })
    const mods = service(ctx, 'mods')
    const tasks = service(ctx, 'tasks')
    const title = `安装模组 ${fileName}`
    const taskId = tasks.run(title, 'mod-install', async (handle) => {
      await mods.install(id, url, fileName, handle)
    })
    return accepted(c, taskId, title)
  })

  app.post('/:id/mods/:diskName/toggle', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const diskName = parseDiskName(c.req.param('diskName'))
    const mods = service(ctx, 'mods')
    // The body is optional: absent means "flip the current state".
    const body = await readOptionalObject(c.req.raw)
    const requested = body.enabled
    if (requested !== undefined && typeof requested !== 'boolean') {
      throw ApiError.validation('字段 enabled 必须是布尔值')
    }
    const current = (await mods.list(id)).find((mod) => mod.diskName === diskName)
    if (!current) throw ApiError.notFound(`模组不存在：${diskName}`)
    const enabled = typeof requested === 'boolean' ? requested : !current.enabled
    return c.json(await mods.setEnabled(id, diskName, enabled))
  })

  app.delete('/:id/mods/:diskName', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const diskName = parseDiskName(c.req.param('diskName'))
    await service(ctx, 'mods').remove(id, diskName)
    return ok(c, diskName)
  })

  // Import an already downloaded jar from disk into mods/.
  app.post('/:id/mods/import', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const body = await readJsonObject(c.req.raw, '导入请求')
    const source = requiredString(body, 'path', { label: 'path', trim: false, max: 1024 })
    const fileName = optionalString(body, 'fileName')
    return c.json(await importMod(ctx, id, source, fileName))
  })

  // Check for mod updates online.
  app.get('/:id/mods/updates', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    return c.json(await service(ctx, 'mods').checkUpdates(id))
  })

  app.get('/:id/diagnostics', async (c) => {
    const id = parseInstanceId(c.req.param('id'))
    const diagnostics = diagnosticsOf(ctx)
    // Diagnostics is an optional core service: absent means "nothing to report".
    const list = diagnostics ? await diagnostics.analyze(id) : []
    return c.json(list)
  })

  return app
}

/** Read a query parameter holding a file path. */
function requireFileQuery(path: string | undefined): string {
  const value = (path ?? '').trim()
  if (!value) throw ApiError.validation('缺少查询参数 path')
  if (value.length > 512) throw ApiError.validation('查询参数 path 过长')
  return value
}

/** Validate a `:diskName` path parameter. */
function parseDiskName(raw: string | undefined): string {
  if (!raw) throw ApiError.validation('缺少文件名')
  let decoded = raw
  try {
    decoded = decodeURIComponent(raw)
  } catch {
    throw ApiError.validation('文件名编码非法')
  }
  if (decoded.includes('/') || decoded.includes('\\') || decoded.includes('..')) {
    throw ApiError.validation('文件名含有非法字符')
  }
  return decoded
}

/** Parse a JSON object body, tolerating an empty request (all fields optional). */
async function readOptionalObject(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text().catch(() => '')
  if (!text.trim()) return {}
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw ApiError.validation('请求体不是合法的 JSON')
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ApiError.validation('请求体必须是一个 JSON 对象')
  }
  return parsed as Record<string, unknown>
}
/**
 * Copy a local `.jar` into the instance `mods/` directory.
 *
 * Core's `ModApi` has no "import from disk" primitive (its `install` takes a
 * URL), so the copy happens here and the freshly written file is then read
 * back through `ctx.mods.list` to return the parsed descriptor. When core
 * grows a native `import` method it is used instead.
 */
async function importMod(
  ctx: Ctx,
  instanceId: string,
  source: string,
  fileName: string | undefined,
): Promise<ModFile> {
  const instances = service(ctx, 'instances')
  const instance = instances.get(instanceId)
  if (!instance) throw ApiError.notFound(`实例不存在：${instanceId}`)
  if (!source.trim()) throw ApiError.validation('路径不能为空')
  if (source.includes('\0')) throw ApiError.validation('路径包含非法字符')
  const absoluteSource = isAbsolute(source) ? resolve(source) : resolve(instance.path, source)
  if (!/\.jar$/i.test(absoluteSource)) throw ApiError.validation('只能导入 .jar 文件')
  let info
  try {
    info = await stat(absoluteSource)
  } catch {
    throw ApiError.notFound(`文件不存在：${absoluteSource}`)
  }
  if (!info.isFile()) throw ApiError.validation('只能导入文件，不能导入目录')
  const target = fileName ?? basename(absoluteSource)
  if (target.includes('/') || target.includes('\\') || target.includes('..')) {
    throw ApiError.validation('文件名含有非法字符')
  }
  const finalName = /\.jar$/i.test(target) ? target : `${target}.jar`
  const modsDir = join(instance.path, 'mods')
  await mkdir(modsDir, { recursive: true })
  const destination = join(modsDir, finalName)
  await copyFile(absoluteSource, destination)
  const mods = service(ctx, 'mods')
  // `list` both validates the jar and returns the parsed descriptor.
  const listed = await mods.list(instanceId)
  const match = listed.find((mod) => mod.diskName === finalName || mod.name === finalName)
  if (match) return match
  return {
    path: `mods/${finalName}`,
    name: finalName,
    isDirectory: false,
    size: info.size,
    modifiedAt: info.mtimeMs,
    enabled: true,
    diskName: finalName,
  }
}