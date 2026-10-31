/**
 * Host integration routes: reveal a file in the OS file manager, open a URL in
 * the default browser.
 *
 * Both endpoints hand a path/URL to an external process, so they are strictly
 * allow-listed: file system paths must live inside the launcher data root (or
 * one of the instance directories), and URLs must use http(s).
 */
import { spawn } from 'node:child_process'
import { statSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'
import { Hono } from 'hono'
import type { RhContext } from '@rhine/core'
import { ApiError, optionalString, readJsonObject, requiredString } from '../http.ts'
import { ok, type Ctx } from './shared.ts'

/** Protocols the launcher is allowed to hand to the OS browser. */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:'])

/**
 * Spawn a detached helper that outlives the request.
 *
 * `stdio: 'ignore'` keeps the child from holding our pipes open, and
 * `unref()` lets the launcher exit while the file manager stays open.
 */
export function spawnDetached(command: string, args: string[]): Promise<void> {
  return new Promise((resolvePromise, rejectPromise) => {
    try {
      const child = spawn(command, args, { detached: true, stdio: 'ignore', windowsHide: false })
      child.once('error', rejectPromise)
      child.once('spawn', () => {
        child.unref()
        resolvePromise()
      })
    } catch (error) {
      rejectPromise(error)
    }
  })
}

/** A validated, allow-listed absolute path. */
export interface ResolvedPath {
  absolute: string
  isDirectory: boolean
}

/** True when `absolute` is `root` itself or lives underneath it. */
function isWithin(root: string, absolute: string): boolean {
  const rel = relative(root, absolute)
  if (rel === '') return true
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Resolve `candidate` and verify it lives inside one of `roots`.
 *
 * @throws ApiError 400 when the path is relative or escapes every allowed
 *   root, and 404 when it does not exist.
 */
export function resolveWithinRoots(candidate: string, roots: string[]): ResolvedPath {
  if (!candidate.trim()) throw new ApiError(400, 'invalid_path', '路径不能为空')
  if (candidate.includes('\0')) throw new ApiError(400, 'invalid_path', '路径包含非法字符')
  const normalized = candidate.replace(/[\\/]+/g, sep)
  if (!isAbsolute(normalized)) throw new ApiError(400, 'invalid_path', '必须使用绝对路径')
  const absolute = resolve(normalized)
  const allowed = roots
    .filter((root): root is string => typeof root === 'string' && root.trim().length > 0)
    .map((root) => resolve(root))
    .some((root) => isWithin(root, absolute))
  if (!allowed) throw new ApiError(400, 'invalid_path', '路径必须位于启动器数据目录或实例目录内')
  let stat
  try {
    stat = statSync(absolute)
  } catch {
    throw new ApiError(400, 'invalid_path', `目录不存在：${absolute}`)
  }
  return { absolute, isDirectory: stat.isDirectory() }
}

/** Every root a reveal request may point into. */
export function allowedRoots(ctx: RhContext): string[] {
  const roots: string[] = []
  try {
    const paths = ctx.paths?.get()
    if (paths?.root) roots.push(paths.root)
  } catch {
    // A missing paths service simply contributes no root.
  }
  try {
    for (const instance of ctx.instances?.list() ?? []) {
      if (instance.path) roots.push(instance.path)
    }
  } catch {
    // Ignore broken instance records: they must not widen or break the check.
  }
  return roots
}

/** True when `value` is an absolute http(s) URL. */
export function isAllowedUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return ALLOWED_PROTOCOLS.has(url.protocol)
  } catch {
    return false
  }
}

/** Platform specific argv that reveals `path` in the file manager. */
export function revealCommand(
  path: string,
  isDirectory: boolean,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === 'win32') {
    // `/select,` highlights the file; a directory opens directly.
    return { command: 'explorer.exe', args: isDirectory ? [path] : [`/select,${path}`] }
  }
  if (platform === 'darwin') {
    return isDirectory
      ? { command: 'open', args: [path] }
      : { command: 'open', args: ['-R', path] }
  }
  return { command: 'xdg-open', args: [isDirectory ? path : resolve(path, '..')] }
}

/** Platform specific argv that opens a URL in the default browser. */
export function openUrlCommand(
  url: string,
  platform: NodeJS.Platform = process.platform,
): { command: string; args: string[] } {
  if (platform === 'win32') return { command: 'cmd', args: ['/c', 'start', '', url] }
  if (platform === 'darwin') return { command: 'open', args: [url] }
  return { command: 'xdg-open', args: [url] }
}

/** Routes mounted under `/api/system`. */
export function systemRoutes(ctx: Ctx): Hono {
  const app = new Hono()

  app.post('/reveal', async (c) => {
    const body = await readJsonObject(c.req.raw, '路径')
    const raw = requiredString(body, 'path', { label: 'path', trim: false, max: 1024 })
    const target = resolveWithinRoots(raw, allowedRoots(ctx))
    const kind = optionalString(body, 'kind')
    const isDirectory = kind === 'directory' ? true : kind === 'file' ? false : target.isDirectory
    const { command, args } = revealCommand(target.absolute, isDirectory)
    await spawnDetached(command, args).catch((error: unknown) => {
      throw new ApiError(500, 'OPEN_FAILED', '无法打开文件管理器', String(error))
    })
    return ok(c)
  })

  app.post('/open', async (c) => {
    const body = await readJsonObject(c.req.raw, '网址')
    const url = requiredString(body, 'url', { label: 'url', trim: false, max: 2048 })
    if (!isAllowedUrl(url)) throw new ApiError(400, 'invalid_path', '只允许打开 http/https 链接')
    const { command, args } = openUrlCommand(url)
    await spawnDetached(command, args).catch((error: unknown) => {
      throw new ApiError(500, 'OPEN_FAILED', '无法打开默认浏览器', String(error))
    })
    return ok(c)
  })

  return app
}