import { readFile } from 'node:fs/promises'
import { relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { beforeAll, describe, expect, it } from 'vitest'
import { extractFontUrls, FONT_COUNTS, RHINE_SOURCE, verifyRhineAssets } from '../scripts/verify-rhine-assets.mjs'

const webRoot = fileURLToPath(new URL('../', import.meta.url))
const shard = 'public/fonts/misans-webfont-4.3.1/light/187.woff2'
const manifest = 'public/fonts/misans-webfont-4.3.1/source.json'
const css = 'src/console/fonts.css'

// Fault injection never writes, renames, deletes, or corrupts the actual public assets.
function replacing(asset: string, transform: (bytes: Buffer) => Buffer | Promise<Buffer>) {
  return async (path: string) => {
    const bytes = await readFile(path)
    return path === resolve(webRoot, asset) ? transform(bytes) : bytes
  }
}
function missing(asset: string) {
  return async (path: string) => {
    if (path === resolve(webRoot, asset)) throw Object.assign(new Error('simulated missing asset'), { code: 'ENOENT' })
    return readFile(path)
  }
}

describe('original MiSans CSS URL extraction', () => {
  it('reads double-quoted, single-quoted and unquoted font URLs', () => {
    expect(extractFontUrls(`src: url("/fonts/a.woff2"), url( '/fonts/b.woff2' ), URL(/fonts/c.woff2)`))
      .toEqual(['/fonts/a.woff2', '/fonts/b.woff2', '/fonts/c.woff2'])
  })
  it('ignores commented URLs and local font substitutions', () => {
    expect(extractFontUrls('/* url("/fonts/not-real.woff2") */ src: local("MiSans");'))
      .toEqual([])
  })
  it('preserves duplicate references so verification can detect them', () => {
    expect(extractFontUrls('url(/fonts/a.woff2) url(/fonts/a.woff2)')).toHaveLength(2)
  })
})

describe('vendored RhineLabUI assets', () => {
  let report: Awaited<ReturnType<typeof verifyRhineAssets>>
  beforeAll(async () => { report = await verifyRhineAssets() })

  it('verifies the pinned assets without a reference checkout or network', () => {
    expect(report.errors).toEqual([])
    expect(report.ok).toBe(true)
    expect(report.checkedFiles).toBe(766)
    expect(report.referenceComparison).toBeNull()
    expect(report.source).toEqual(RHINE_SOURCE)
    expect(report.source.commit).toBe('12cc5e4013acb9408f753ff71de6b8492299b7c8')
  })
  it('ships every original MiSans shard and resolves all preserved CSS font URLs', () => {
    expect(report.fonts.files).toBe(761)
    expect(report.fonts.woff2).toBe(753)
    expect(report.fonts.weights).toEqual(FONT_COUNTS)
    expect(report.fonts.referencedUrls).toBe(753)
    expect(report.fonts.uniqueUrls).toBe(753)
    expect(report.fonts.manifestSha256LF).toBe('ff2250bc0646c0b609eb1fb569b0488d8d37efdcd186cb1bc1fd9869fa208fb1')
    expect(report.cssSha256LF).toBe('63d5271b9154a55e23a26e1a5ec73ffa9e6874d56db4c6a629c88175d50fa975')
  })
  it('retains both exact original GLBs rather than a replacement rack', () => {
    expect(report.models).toEqual([
      { path: 'public/assets/archive-assembly.glb', bytes: 3343744, sha256: 'd411170676f55a327c286e67e462f98b446667811c725318bab85657eaee06ec' },
      { path: 'public/assets/archive-cassette.glb', bytes: 3565116, sha256: 'dda42b9b3b471d11c69820a64084d254a64b27761287ab0e35dd8387ec0a0bed' },
    ])
  })
  it('reports a missing shard and its unresolved CSS URL', async () => {
    const result = await verifyRhineAssets({ readAsset: missing(shard) })
    expect(result.ok).toBe(false)
    expect(result.fonts.woff2).toBe(752)
    expect(result.errors).toContainEqual({ path: shard, reason: 'Cannot read asset: ENOENT' })
    expect(result.errors).toContainEqual({ path: css, reason: 'Unresolved font URL: /fonts/misans-webfont-4.3.1/light/187.woff2' })
  })
  it('detects same-size font corruption instead of checking existence alone', async () => {
    const result = await verifyRhineAssets({ readAsset: replacing(shard, bytes => {
      const changed = Buffer.from(bytes)
      changed[changed.length - 1] ^= 1
      return changed
    }) })
    expect(result.ok).toBe(false)
    expect(result.errors.some(error => error.path === shard && error.reason.startsWith('SHA-256 mismatch'))).toBe(true)
    expect(result.errors.some(error => error.reason.startsWith('Byte length mismatch'))).toBe(false)
  })
  it('rejects placeholder font bytes and invalid WOFF2 signatures', async () => {
    const result = await verifyRhineAssets({ readAsset: replacing(shard, () => Buffer.from('placeholder')) })
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({ path: shard, reason: 'Invalid WOFF2 signature' })
  })
  it('rejects a truncated or invalid GLB', async () => {
    const asset = 'public/assets/archive-cassette.glb'
    const result = await verifyRhineAssets({ readAsset: replacing(asset, () => Buffer.alloc(11)) })
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({ path: asset, reason: 'Invalid GLB v2 header or declared length' })
  })
  it('does not accept local font substitution in place of the original CSS', async () => {
    const result = await verifyRhineAssets({ readAsset: replacing(css, () => Buffer.from('@font-face{font-family:MiSans;src:local("Arial")}')) })
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({ path: css, reason: 'Local font substitution must not replace the original MiSans' })
    expect(result.errors).toContainEqual({ path: css, reason: 'Expected 753 unique MiSans font URLs' })
  })
  it('rejects newly invented or separately licensed font URLs', async () => {
    const result = await verifyRhineAssets({ readAsset: replacing(css, bytes => Buffer.from(bytes.toString() + '\n@font-face{src:url(/fonts/novecento/kit.woff2)}')) })
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({ path: css, reason: 'Unrecognized font URL: /fonts/novecento/kit.woff2' })
  })
  it('allows CRLF checkout differences without weakening binary hashes', async () => {
    const result = await verifyRhineAssets({ readAsset: replacing(css, bytes => Buffer.from(bytes.toString().replace(/\r?\n/g, '\r\n'))) })
    expect(result.errors).toEqual([])
    expect(result.cssSha256LF).toBe(report.cssSha256LF)
    expect(result.models).toEqual(report.models)
  })
  it('fails closed before using paths from an altered font manifest', async () => {
    const reads: string[] = []
    const result = await verifyRhineAssets({ readAsset: async (path: string) => {
      reads.push(path)
      if (path === resolve(webRoot, manifest)) return Buffer.from(JSON.stringify({ files: [{ path: '../../../../../unowned-file' }] }))
      return readFile(path)
    } })
    expect(result.ok).toBe(false)
    expect(result.fonts.woff2).toBe(0)
    expect(result.errors.some(error => error.path === manifest && error.reason.startsWith('SHA-256 mismatch'))).toBe(true)
    expect(reads.some(path => path.includes('unowned-file'))).toBe(false)
  })
  it.each([
    'public/licenses/rhine-lab.txt',
    'public/fonts/MiSans-license.pdf',
    'public/fonts/NOTICE.txt',
    'public/assets/boot-lettering-notice.txt',
  ])('requires the retained attribution or license: %s', async asset => {
    const result = await verifyRhineAssets({ readAsset: missing(asset) })
    expect(result.ok).toBe(false)
    expect(result.errors).toContainEqual({ path: asset, reason: 'Cannot read asset: ENOENT' })
  })
  it('compares a supplied reference and reports text-only line-ending differences', async () => {
    const referenceRoot = resolve(webRoot, '__in_memory_reference__')
    const result = await verifyRhineAssets({ referenceRoot, readAsset: async (path: string) => {
      const rel = relative(referenceRoot, path).replaceAll('\\', '/')
      if (rel.startsWith('../')) return readFile(path)
      const target = rel === 'src/fonts.css' ? css : rel === 'LICENSE' ? 'public/licenses/rhine-lab.txt' : rel
      const bytes = await readFile(resolve(webRoot, target))
      if (rel !== 'src/fonts.css') return bytes
      const text = bytes.toString()
      return Buffer.from(text.includes('\r\n') ? text.replaceAll('\r\n', '\n') : text.replaceAll('\n', '\r\n'))
    } })
    expect(result.ok).toBe(true)
    expect(result.errors).toEqual([])
    expect(result.referenceComparison?.lineEndingDifferences).toEqual([css])
  })
})
