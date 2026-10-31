#!/usr/bin/env node
/**
 * Read-only, offline verification of assets vendored from the original RhineLabUI.
 * Run from any directory: node packages/web/scripts/verify-rhine-assets.mjs
 * Optional live comparison: ... --reference .reference/RhineLabUI
 * Text checks normalize CRLF only; font/model/PDF bytes must match exactly.
 * No licensed Novecento webfont kit is downloaded or required. Keep the artwork fallback.
 */
import { createHash } from 'node:crypto'
import { readFile, readdir } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

export const RHINE_SOURCE = Object.freeze({
  repository: 'https://github.com/LBEILC/RhineLabUI',
  commit: '12cc5e4013acb9408f753ff71de6b8492299b7c8',
  fontPackage: 'misans-webfont@4.3.1',
  fontVersion: '4.003',
})
export const FONT_COUNTS = Object.freeze({ light: 188, regular: 188, demibold: 188, bold: 189 })
const WEB_ROOT = fileURLToPath(new URL('../', import.meta.url))
const FONT_ROOT = 'public/fonts/'
const FONT_PACKAGE = FONT_ROOT + 'misans-webfont-4.3.1/'
const MANIFEST = FONT_PACKAGE + 'source.json'
const CSS = 'src/console/fonts.css'

// SHA-256 recorded from the clean original checkout above. Text hashes use LF.
const PINNED = [
  { path: CSS, sha256: '63d5271b9154a55e23a26e1a5ec73ffa9e6874d56db4c6a629c88175d50fa975', reference: 'src/fonts.css' },
  { path: 'public/licenses/rhine-lab.txt', sha256: 'b42f104f4b3687773c76efbf990c1ab7b306a8c59035958c0b886dfbbcf2cd91', reference: 'LICENSE' },
  { path: 'public/assets/archive-assembly.glb', bytes: 3343744, sha256: 'd411170676f55a327c286e67e462f98b446667811c725318bab85657eaee06ec' },
  { path: 'public/assets/archive-cassette.glb', bytes: 3565116, sha256: 'dda42b9b3b471d11c69820a64084d254a64b27761287ab0e35dd8387ec0a0bed' },
  { path: 'public/assets/boot-lettering-notice.txt', sha256: '0743c39c41e743736963730741bf310632a42a1b82e7c7d81ea6479f21210729' },
  { path: FONT_ROOT + 'MiSans-license.pdf', bytes: 79535, sha256: '4a93a27cd2bd81b3b5ecfd0a853144a876fa26938a93a68443c67d74172fcb86' },
  { path: FONT_ROOT + 'NOTICE.txt', sha256: '68056442ee9108f4898b193b18d1f6f3aa34c782901ec27ba85875627e2a02ff' },
  { path: FONT_PACKAGE + 'UPSTREAM-README.md', sha256: '084502087c6b8e0bd028adfe4dbccc83e00c4c203f09abc34593e56e85e367b6' },
  { path: MANIFEST, sha256: 'ff2250bc0646c0b609eb1fb569b0488d8d37efdcd186cb1bc1fd9869fa208fb1' },
  { path: FONT_PACKAGE + 'light/upstream.css.txt', sha256: '2e29594b828cda669299514523e969af0888a93c8c5154c7acf7f00feeed9590' },
  { path: FONT_PACKAGE + 'regular/upstream.css.txt', sha256: '5d3a32d5487f850ba3892e57e276ee88488e6ecced55e6f33e4a94cd459dadd3' },
  { path: FONT_PACKAGE + 'demibold/upstream.css.txt', sha256: 'd2d7485f78a2322a6e02e2a6755d5844e5df4ba4a6f5be74bd4d92ddf2956fc1' },
  { path: FONT_PACKAGE + 'bold/upstream.css.txt', sha256: 'f0bffc2e5b50f926908c47dda387ea596e5acdf58aa7064a5231bc7014acbd6d' },
]

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex')
}
const isText = path => /\.(?:css|txt|md|json)$/.test(path)
const normalizedBytes = (path, bytes) => isText(path)
  ? Buffer.from(bytes.toString('utf8').replaceAll('\r\n', '\n'))
  : bytes

/** Extract quoted and unquoted URLs without mistaking commented examples for assets. */
export function extractFontUrls(css) {
  const uncommented = css.replace(/\/\*[\s\S]*?\*\//g, '')
  return [...uncommented.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^\s)]+))\s*\)/gi)]
    .map(match => match[1] ?? match[2] ?? match[3])
}

async function fontFiles(root, relative = '') {
  const entries = await readdir(resolve(root, relative), { withFileTypes: true })
  const result = []
  for (const entry of entries) {
    const path = relative + entry.name
    if (entry.isDirectory()) result.push(...await fontFiles(root, path + '/'))
    else result.push(path) // Symlinks and other unexpected entries are not traversed.
  }
  return result.sort()
}

/**
 * The optional reader allows negative tests without changing real/user-owned assets.
 * @param {{webRoot?: string, referenceRoot?: string, readAsset?: (path: string) => Promise<Buffer>}} options
 */
export async function verifyRhineAssets({ webRoot = WEB_ROOT, referenceRoot, readAsset = readFile } = {}) {
  const errors = []
  const records = []
  const contents = new Map()
  const lineEndingDifferences = []
  const issue = (path, reason) => errors.push({ path, reason })

  async function check(expected) {
    let bytes
    try {
      bytes = await readAsset(resolve(webRoot, expected.path))
    } catch (error) {
      issue(expected.path, 'Cannot read asset: ' + (error.code ?? error.message))
      return
    }
    const canonical = normalizedBytes(expected.path, bytes)
    const digest = sha256(canonical)
    records.push({ path: expected.path, bytes: bytes.length, sha256: sha256(bytes) })
    contents.set(expected.path, bytes)
    if (expected.bytes !== undefined && bytes.length !== expected.bytes) {
      issue(expected.path, 'Byte length mismatch: expected ' + expected.bytes + ', received ' + bytes.length)
    }
    if (digest !== expected.sha256) {
      issue(expected.path, 'SHA-256 mismatch: expected ' + expected.sha256 + ', received ' + digest)
    }
    if (expected.path.endsWith('.woff2') && bytes.subarray(0, 4).toString('ascii') !== 'wOF2') {
      issue(expected.path, 'Invalid WOFF2 signature')
    }
    if (expected.path.endsWith('.glb') && (bytes.length < 12 || bytes.subarray(0, 4).toString('ascii') !== 'glTF'
      || bytes.readUInt32LE(4) !== 2 || bytes.readUInt32LE(8) !== bytes.length)) {
      issue(expected.path, 'Invalid GLB v2 header or declared length')
    }
    if (referenceRoot) {
      try {
        const original = await readAsset(resolve(referenceRoot, expected.reference ?? expected.path))
        if (!canonical.equals(normalizedBytes(expected.path, original))) {
          issue(expected.path, 'Asset differs from original reference')
        } else if (!bytes.equals(original)) {
          lineEndingDifferences.push(expected.path)
        }
      } catch (error) {
        issue(expected.path, 'Cannot read original reference: ' + (error.code ?? error.message))
      }
    }
  }

  for (const expected of PINNED) await check(expected)
  const manifestBytes = contents.get(MANIFEST)
  let fonts = []
  // Fail closed: never use file paths from an altered/untrusted manifest.
  if (manifestBytes && !errors.some(error => error.path === MANIFEST)) {
    try {
      const manifest = JSON.parse(manifestBytes.toString('utf8'))
      if (manifest.package !== 'misans-webfont' || manifest.version !== '4.3.1'
        || manifest.fontVersion !== '4.003' || manifest.fontFilesModified !== false
        || !Array.isArray(manifest.files) || manifest.files.length !== 753) {
        throw new Error('Unexpected original MiSans package metadata or file count')
      }
      fonts = manifest.files
      const seen = new Set()
      for (const font of fonts) {
        if (!/^(light|regular|demibold|bold)\/\d+\.woff2$/.test(font.path)
          || !/^[a-f0-9]{64}$/.test(font.sha256) || !Number.isSafeInteger(font.bytes)
          || font.bytes <= 0 || seen.has(font.path)) {
          throw new Error('Invalid or duplicate font manifest entry')
        }
        seen.add(font.path)
      }
    } catch (error) {
      fonts = []
      issue(MANIFEST, error.message)
    }
  }

  const expectedFontPaths = new Set(PINNED.filter(file => file.path.startsWith(FONT_ROOT)).map(file => file.path))
  const weights = { light: 0, regular: 0, demibold: 0, bold: 0 }
  for (const font of fonts) {
    const path = FONT_PACKAGE + font.path
    expectedFontPaths.add(path)
    weights[font.path.split('/')[0]]++
    await check({ ...font, path })
  }
  for (const [weight, count] of Object.entries(FONT_COUNTS)) {
    if (weights[weight] !== count) issue(MANIFEST, 'Expected ' + count + ' ' + weight + ' font shards, received ' + weights[weight])
  }

  const css = contents.get(CSS)?.toString('utf8') ?? ''
  const urls = extractFontUrls(css)
  const uniqueUrls = new Set(urls)
  if (urls.length !== 753 || uniqueUrls.size !== 753) issue(CSS, 'Expected 753 unique MiSans font URLs')
  if (/local\s*\(/i.test(css)) issue(CSS, 'Local font substitution must not replace the original MiSans')
  const expectedUrls = new Set(fonts.map(font => '/fonts/misans-webfont-4.3.1/' + font.path))
  for (const url of uniqueUrls) {
    if (!expectedUrls.has(url)) issue(CSS, 'Unrecognized font URL: ' + url)
    else if (!contents.has('public' + url)) issue(CSS, 'Unresolved font URL: ' + url)
  }
  for (const url of expectedUrls) {
    if (!uniqueUrls.has(url)) issue(CSS, 'Original font shard not referenced: ' + url)
  }

  try {
    for (const path of await fontFiles(resolve(webRoot, FONT_ROOT))) {
      if (!expectedFontPaths.has(FONT_ROOT + path)) issue(FONT_ROOT + path, 'Unexpected font-tree file (do not bundle the separately licensed Novecento kit)')
    }
  } catch (error) {
    issue(FONT_ROOT, 'Cannot list font assets: ' + (error.code ?? error.message))
  }

  const fontRecords = records.filter(file => file.path.startsWith(FONT_ROOT)).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0)
  // Reproducible raw-tree digest: relative path TAB byte length TAB SHA-256 LF.
  const treeHash = sha256(fontRecords.map(file => file.path.slice(FONT_ROOT.length) + '\t' + file.bytes + '\t' + file.sha256 + '\n').join(''))
  return {
    ok: errors.length === 0,
    source: RHINE_SOURCE,
    checkedFiles: records.length,
    fonts: {
      files: fontRecords.length,
      woff2: fontRecords.filter(file => file.path.endsWith('.woff2')).length,
      bytes: fontRecords.reduce((sum, file) => sum + file.bytes, 0),
      weights,
      referencedUrls: urls.length,
      uniqueUrls: uniqueUrls.size,
      rawTreeSha256: treeHash,
      manifestSha256LF: manifestBytes ? sha256(normalizedBytes(MANIFEST, manifestBytes)) : null,
    },
    models: records.filter(file => file.path.endsWith('.glb')),
    cssSha256LF: contents.has(CSS) ? sha256(normalizedBytes(CSS, contents.get(CSS))) : null,
    referenceComparison: referenceRoot ? { root: resolve(referenceRoot), lineEndingDifferences } : null,
    errors,
  }
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  const args = process.argv.slice(2)
  if (args.length !== 0 && !(args.length === 2 && args[0] === '--reference' && args[1] && !args[1].startsWith('--'))) {
    console.error('Usage: node verify-rhine-assets.mjs [--reference <original-RhineLabUI-directory>]')
    process.exitCode = 2
  } else {
    try {
      const report = await verifyRhineAssets({ referenceRoot: args[1] })
      console.log(JSON.stringify(report, null, 2))
      process.exitCode = report.ok ? 0 : 1
    } catch (error) {
      console.error('Rhine asset verification failed: ' + error.message)
      process.exitCode = 1
    }
  }
}
