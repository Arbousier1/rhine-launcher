import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import { constants } from 'node:fs'
import { lstat, mkdir, open, realpath, type FileHandle } from 'node:fs/promises'
import { isAbsolute, join, parse, relative, resolve, sep } from 'node:path'
import { createHash } from 'node:crypto'
import type { RhPaths } from '../contracts.ts'

export type Operation = Pick<FeatureEnvironment, 'signal' | 'task'>
export const MAX_FILE_BYTES = 512 * 1024 * 1024
export type Hashes = Partial<Record<'sha1' | 'sha256' | 'sha512' | 'md5', string>>

export function check(op?: Operation): void {
  op?.signal.throwIfAborted()
  op?.task?.throwIfCancelled()
}
export function fail(message: string, code = 'VALIDATION_ERROR', status = 400): never {
  throw new FeatureError(code, message, status)
}
export function object(value: unknown, label = '对象'): Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(label + '必须是对象')
  return value as Record<string, any>
}
export function text(value: unknown, label: string, max = 255): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) fail(label + '无效')
  return value
}
export function version(value: unknown, label: string): string {
  const result = text(value, label, 128)
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._+-]*$/.test(result) || result.includes('..')) fail(label + '无效')
  return result
}
export function size(value: unknown, label: string, max = MAX_FILE_BYTES): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > max) fail(label + '大小无效或超出限制')
  return value as number
}
export function hashes(value: unknown, required = true): Hashes {
  const source = object(value, 'hashes')
  const out: Hashes = {}
  for (const [algorithm, length] of [['sha1', 40], ['sha256', 64], ['sha512', 128], ['md5', 32]] as const) {
    const hash = source[algorithm]
    if (hash === undefined) continue
    if (typeof hash !== 'string' || !new RegExp('^[0-9a-fA-F]{' + length + '}$').test(hash)) fail(algorithm + ' 校验值无效')
    out[algorithm] = hash.toLowerCase()
  }
  if (required && !Object.keys(out).length) fail('文件缺少可验证的哈希值')
  return out
}
export function httpUrl(value: unknown): string {
  const raw = text(value, 'URL', 8192)
  let url: URL
  try { url = new URL(raw) } catch { return fail('URL 无效') }
  if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || url.hash) fail('只允许无凭据的 HTTP(S) URL')
  return url.href
}

/** Reject rather than silently repair paths: Windows aliases must be safe on every OS. */
export function relativePath(value: unknown, directory = false): string {
  const raw = text(value, '相对路径', 1024)
  const path = directory && raw.endsWith('/') ? raw.slice(0, -1) : raw
  if (!path || isAbsolute(path) || /[\\<>:"|?*\u0000-\u001f\u007f]/.test(path) || /%[0-9a-f]{2}/i.test(path)) fail('不安全的路径：' + raw, 'UNSAFE_PATH')
  for (const part of path.split('/')) {
    if (!part || part === '.' || part === '..' || /[. ]$/.test(part) || part.length > 255 || /^(con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i.test(part)) fail('不安全的路径：' + raw, 'UNSAFE_PATH')
  }
  return path
}
export function fileName(value: unknown): string {
  const name = relativePath(value)
  if (name.includes('/')) fail('必须使用文件名而不是路径', 'UNSAFE_PATH')
  return name
}
export function packPath(value: unknown): string {
  const path = relativePath(value)
  const first = path.split('/')[0].toLowerCase()
  if (first === 'instance.json' || first === '.rhine') fail('整合包不能覆盖启动器元数据：' + path, 'UNSAFE_PATH')
  return path
}
export function inside(root: string, target: string): string {
  const base = resolve(root)
  const absolute = resolve(target)
  const rel = relative(base, absolute)
  if (!rel || rel === '..' || rel.startsWith('..' + sep) || isAbsolute(rel)) fail('路径越界：' + target, 'UNSAFE_PATH')
  return absolute
}
export async function maybeStat(path: string) {
  try { return await lstat(path) } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined
    throw error
  }
}
/** Walk every ancestor with lstat; do not follow a directory junction or symlink. */
export async function directory(path: string, create = false): Promise<string> {
  const absolute = resolve(path)
  const root = parse(absolute).root
  let current = root
  for (const segment of absolute.slice(root.length).split(sep).filter(Boolean)) {
    current = join(current, segment)
    let info = await maybeStat(current)
    if (!info && create) {
      try { await mkdir(current) } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error }
      info = await lstat(current)
    }
    if (!info || info.isSymbolicLink() || !info.isDirectory()) fail('目录不存在或含有符号链接：' + current, 'UNSAFE_PATH')
  }
  return absolute
}
export async function targetPath(root: string, path: string, createParents = false): Promise<string> {
  const safe = relativePath(path)
  await directory(root)
  const target = inside(root, join(root, ...safe.split('/')))
  const parent = parse(target).dir
  await directory(parent, createParents)
  const info = await maybeStat(target)
  if (info && (info.isSymbolicLink() || !info.isFile())) fail('目标不是普通文件：' + safe, 'UNSAFE_PATH')
  return target
}
export async function stagedSource(paths: RhPaths, input: unknown, max = MAX_FILE_BYTES): Promise<string> {
  const raw = text(input, 'path', 4096)
  // Local user-selected archives are read-only inputs. Relative paths address
  // the launcher's upload staging; all writes still use targetPath() confinement.
  const source = isAbsolute(raw) ? resolve(raw) : inside(paths.temp, join(paths.temp,relativePath(raw)))
  if(!/\.(jar|zip|mrpack|litemod)(?:\.disabled)?$/i.test(source))fail('只允许导入模组或整合包压缩文件','UNSAFE_PATH')
  await directory(parse(source).dir)
  const info = await lstat(source)
  if (info.isSymbolicLink() || !info.isFile()) fail('导入源必须是普通文件', 'UNSAFE_PATH')
  size(info.size, '导入源', max)
  if(resolve(await realpath(source)).toLowerCase()!==resolve(source).toLowerCase())fail('不允许通过链接访问导入源','UNSAFE_PATH')
  return source
}
export async function openRegular(path: string): Promise<FileHandle> {
  await directory(parse(path).dir)
  const before = await lstat(path)
  if (!before.isFile() || before.isSymbolicLink()) fail('不是普通文件：' + path, 'UNSAFE_PATH')
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW || 0))
  try {
    const actual = await handle.stat()
    if (!actual.isFile() || actual.ino !== before.ino || actual.dev !== before.dev) fail('文件在读取前发生变化', 'FILE_CHANGED', 409)
    return handle
  } catch (error) { await handle.close(); throw error }
}
export interface Snapshot { size: number; mtimeMs: number; ctimeMs: number; ino: number; dev: number; hashes: Hashes }
export async function fingerprint(path: string, op?: Operation, algorithms: (keyof Hashes)[] = ['sha1', 'sha256', 'sha512']): Promise<Snapshot> {
  check(op)
  const handle = await openRegular(path)
  try {
    const before = await handle.stat()
    size(before.size, '文件')
    const digests = algorithms.map(algorithm => [algorithm, createHash(algorithm)] as const)
    const chunk = Buffer.alloc(128 * 1024)
    let position = 0
    while (true) {
      check(op)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (!bytesRead) break
      position += bytesRead
      if (position > MAX_FILE_BYTES) fail('文件超过大小限制')
      for (const [, digest] of digests) digest.update(chunk.subarray(0, bytesRead))
    }
    const after = await handle.stat()
    const named = await lstat(path)
    if (before.size !== position || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || after.size !== before.size || named.isSymbolicLink() || named.ino !== before.ino || named.dev !== before.dev) fail('文件在读取时发生变化', 'FILE_CHANGED', 409)
    check(op)
    return { size: before.size, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs, ino: before.ino, dev: before.dev, hashes: Object.fromEntries(digests.map(([key, digest]) => [key, digest.digest('hex')])) }
  } finally { await handle.close() }
}
export function sameFile(a: Snapshot, b: Snapshot): boolean {
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.ino === b.ino && a.dev === b.dev && a.hashes.sha256 === b.hashes.sha256
}
