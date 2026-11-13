import { readFile, stat, realpath } from 'node:fs/promises'
import { extname, resolve, sep } from 'node:path'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RhPaths } from '../contracts.ts'
import { FeatureError } from '@rhine/plugin-api'
const types: Record<string, string> = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.gif': 'image/gif', '.woff2': 'font/woff2', '.mp3': 'audio/mpeg', '.ogg': 'audio/ogg', '.mp4': 'video/mp4' }
export async function media(path: unknown, range: string | null, env: FeatureEnvironment) {
  if (typeof path !== 'string') throw new FeatureError('INVALID_MEDIA', 'Media path is required', 400)
  const root = await realpath(env.use<RhPaths>('paths.get').root)
  const target = await realpath(resolve(path))
  if (!target.startsWith(root + sep)) throw new FeatureError('FORBIDDEN_MEDIA', 'Media must belong to the managed data directory', 403)
  const type = types[extname(target).toLowerCase()]
  if (!type) throw new FeatureError('FORBIDDEN_MEDIA', 'Unsupported media type', 403)
  const info = await stat(target)
  if (!info.isFile() || info.size > 128 * 1024 * 1024) throw new FeatureError('MEDIA_TOO_LARGE', 'Media file is too large', 413)
  const bytes = await readFile(target)
  const headers: Record<string, string> = { 'content-type': type, 'accept-ranges': 'bytes', 'cache-control': 'private, no-cache' }
  if (range) {
    const match = /^bytes=(\d*)-(\d*)$/.exec(range)
    if (!match) return new Response(null, { status: 416 })
    const start = match[1] ? Number(match[1]) : Math.max(0, bytes.length - Number(match[2]))
    const end = match[1] && match[2] ? Math.min(Number(match[2]), bytes.length - 1) : bytes.length - 1
    if (start > end || start >= bytes.length) return new Response(null, { status: 416 })
    headers['content-range'] = 'bytes ' + start + '-' + end + '/' + bytes.length
    return new Response(bytes.subarray(start, end + 1), { status: 206, headers })
  }
  return new Response(new Uint8Array(bytes), { headers })
}
