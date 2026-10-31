/**
 * Unit tests for static hosting: SPA fallback, MIME types and path traversal.
 */
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { ENTRY_DOCUMENT as ENTRY, hasWebDist, lookupStatic, readStaticFile, resolveWebDist } from '../src/static.ts'

let dir = ''

beforeAll(async () => {
  dir = await mkdtemp(join(tmpdir(), 'rhine-static-'))
  await mkdir(join(dir, 'assets'), { recursive: true })
  await writeFile(join(dir, ENTRY), '<!doctype html><title>Rhine</title>', 'utf8')
  await writeFile(join(dir, 'assets', 'index-abc123.js'), 'console.log(1)', 'utf8')
  await writeFile(join(dir, 'favicon.svg'), '<svg/>', 'utf8')
})

afterAll(async () => {
  if (dir) await rm(dir, { recursive: true, force: true })
})

describe('hasWebDist', () => {
  it('is true when the entry document exists', () => {
    expect(hasWebDist(dir)).toBe(true)
  })

  it('is false for a directory without the entry document', () => {
    expect(hasWebDist(join(dir, 'assets'))).toBe(false)
  })
})

describe('lookupStatic', () => {
  it('serves the entry document for the root path', () => {
    const lookup = lookupStatic(dir, '/')
    expect(lookup?.file).toBe(join(dir, ENTRY))
    expect(lookup?.type).toContain('text/html')
  })

  it('serves a hashed asset with an immutable cache header', () => {
    const lookup = lookupStatic(dir, '/assets/index-abc123.js')
    expect(lookup?.type).toContain('javascript')
    expect(lookup?.cacheControl).toContain('immutable')
  })

  it('serves an svg with the right mime type', () => {
    const lookup = lookupStatic(dir, '/favicon.svg')
    expect(lookup?.type).toBe('image/svg+xml')
  })

  it('falls back to the entry document for an unknown route', () => {
    const lookup = lookupStatic(dir, '/archive/archive-1')
    expect(lookup?.file).toBe(join(dir, ENTRY))
    expect(lookup?.cacheControl).toBe('no-cache')
  })

  it('returns undefined for a missing asset with an extension', () => {
    expect(lookupStatic(dir, '/assets/missing.js')).toBeUndefined()
  })

  it('ignores a query string', () => {
    expect(lookupStatic(dir, '/assets/index-abc123.js?v=1')?.type).toContain('javascript')
  })

  it('rejects a traversal attempt outside the dist directory', () => {
    expect(() => lookupStatic(dir, '/../../etc/passwd')).toThrow('非法的静态资源路径')
  })
})

describe('readStaticFile', () => {
  it('streams the file body', async () => {
    const lookup = lookupStatic(dir, '/' + ENTRY)!
    const response = await readStaticFile(lookup)
    expect(response.status).toBe(200)
    expect(await response.text()).toContain('Rhine')
  })
})

describe('resolveWebDist', () => {
  it('honours an explicit override', () => {
    expect(resolveWebDist('C:/custom/dist')).toBe(resolveWebDist('C:/custom/dist'))
    expect(resolveWebDist('C:/custom/dist')).toMatch(/custom/)
  })
})

describe('secondary shell document', () => {
  it('serves app.html when present', async () => {
    await writeFile(join(dir, 'app.html'), '<!doctype html><title>App</title>', 'utf8')
    const lookup = lookupStatic(dir, '/app.html')
    expect(lookup?.type).toContain('text/html')
    expect(lookup?.cacheControl).toBe('no-cache')
  })
})
