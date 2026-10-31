/**
 * Static hosting for the built web client.
 *
 * In development the Vite dev server proxies `/api` and `/ws` here, so this
 * module is only exercised by `pnpm build` output or by a packaged release.
 * When `packages/web/dist` has not been built yet we answer with a small
 * Chinese explanation page instead of a raw 404.
 */
import { createReadStream, existsSync, statSync } from 'node:fs'
import type { ReadableStream as WebReadableStream } from 'node:stream/web'
import { Readable } from 'node:stream'
import { extname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ApiError } from './http.ts'

/** The archive console is the product entry; the React shell lives at /app.html. */
export const ENTRY_DOCUMENT = 'console.html'

/** `packages/web/dist` relative to this file (src → server → packages). */
function defaultDistDir(): string {
  try {
    return fileURLToPath(new URL('../../web/dist/', import.meta.url))
  } catch {
    return resolve(process.cwd(), 'packages/web/dist')
  }
}

/** Content types for the handful of extensions a Vite build emits. */
const MIME_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.txt': 'text/plain; charset=utf-8',
  '.wasm': 'application/wasm',
}

/** `Cache-Control` for hashed bundle output vs. the HTML entry point. */
const IMMUTABLE = 'public, max-age=31536000, immutable'
const NO_CACHE = 'no-cache'

/** Result of locating a static asset. */
export interface StaticLookup {
  /** Absolute path of the file to stream. */
  file: string
  /** MIME type based on the extension. */
  type: string
  /** Cache-Control header value. */
  cacheControl: string
}

/** Resolve the directory that holds the built client. */
export function resolveWebDist(override?: string): string {
  const dir = override ?? process.env.RHINE_WEB_DIST ?? defaultDistDir()
  return resolve(dir)
}

/** True when the built client is present (checked once per request, it is cheap). */
export function hasWebDist(dir: string): boolean {
  return existsSync(join(dir, ENTRY_DOCUMENT))
}

/** Guard against `..` escaping the dist directory. */
function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate)
  if (rel === '') return true
  // A relative path that starts with `..` (or is absolute) escapes the root.
  return !rel.startsWith('..') && !isAbsolute(rel)
}

/**
 * Map a request path to a file inside the dist directory.
 *
 * @param dir — the built client directory.
 * @param pathname — the URL path (`/` for the SPA entry).
 * @returns the file to stream, or `undefined` when it must fall back to
 *   `index.html` (SPA routing) because the asset does not exist.
 */
export function lookupStatic(dir: string, pathname: string): StaticLookup | undefined {
  const clean = decodeURIComponent(pathname.split('?')[0] ?? '/')
  const relative = clean === '/' ? ENTRY_DOCUMENT : clean.replace(/^\/+/, '')
  const candidate = resolve(dir, relative)
  if (!isInside(dir, candidate)) throw ApiError.validation('非法的静态资源路径')
  if (existsSync(candidate) && statSync(candidate).isFile()) {
    return {
      file: candidate,
      type: MIME_TYPES[extname(candidate).toLowerCase()] ?? 'application/octet-stream',
      cacheControl: relative.endsWith('.html') ? NO_CACHE : (relative.startsWith('assets/') ? IMMUTABLE : NO_CACHE),
    }
  }
  // SPA fallback: anything that is not a file and has no extension is a route.
  if (extname(relative) !== '') return undefined
  const index = join(dir, ENTRY_DOCUMENT)
  if (!existsSync(index)) return undefined
  return { file: index, type: MIME_TYPES['.html'], cacheControl: NO_CACHE }
}

/** Stream a file as a fetch `Response` body. */
export async function readStaticFile(lookup: StaticLookup): Promise<Response> {
  const stream = Readable.toWeb(createReadStream(lookup.file)) as WebReadableStream<Uint8Array>
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: { 'Content-Type': lookup.type, 'Cache-Control': lookup.cacheControl },
  })
}

/** The Chinese placeholder shown before the client has been built. */
export const PLACEHOLDER_HTML = `<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Rhine Launcher · 前端尚未构建</title>
    <style>
      :root { color-scheme: light; }
      body {
        margin: 0; min-height: 100vh; display: grid; place-items: center;
        background: #f2f0eb; color: #171713;
        font: 15px/1.7 MiSans, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
      }
      main { max-width: 34rem; padding: 2.5rem 2rem; border: 1px solid #bdb8ad; background: #e9e6df; }
      h1 { margin: 0 0 .25rem; font-size: 20px; letter-spacing: .02em; font-weight: 600; }
      .eyebrow { margin: 0 0 1.25rem; font-size: 12px; letter-spacing: .18em; text-transform: uppercase; color: #77756d; }
      hr { border: 0; border-top: 1px solid #bdb8ad; margin: 1.25rem 0; }
      code { background: #f7f5f1; border: 1px solid #bdb8ad; padding: .1rem .35rem; font-size: 13px; }
      p { margin: .5rem 0; }
      a { color: #c98b3f; }
    </style>
  </head>
  <body>
    <main>
      <p class="eyebrow">Rhine Launcher / Server</p>
      <h1>前端资源尚未构建</h1>
      <p>后端已经在正常工作，但没有找到 <code>packages/web/dist</code>。</p>
      <hr />
      <p>先构建前端，然后刷新本页：</p>
      <p><code>pnpm --filter @rhine/web build</code></p>
      <p>开发时请改用 Vite 开发服务器（默认 5183 端口），它会把 <code>/api</code> 与 <code>/ws</code> 代理到这里。</p>
      <hr />
      <p>API 可用：<a href="/api/bootstrap">/api/bootstrap</a> · <a href="/api/health">/api/health</a></p>
    </main>
  </body>
</html>
`

/** Read the placeholder page (used when the client is not built). */
export async function readPlaceholder(): Promise<string> {
  return PLACEHOLDER_HTML
}