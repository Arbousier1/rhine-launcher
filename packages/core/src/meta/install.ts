/**
 * Vanilla installation: client jar, libraries (natives included), asset index
 * and every asset object.
 *
 * Downloads are expressed as plain {@link DownloadItem} lists so this module
 * stays free of the download service and can be unit tested. The ordering and
 * hash handling mirror HMCL's `GameDownloadTask`/`GameAssetDownloadTask`:
 * hashes come from the version json, assets use the SHA1-as-path layout.
 */
import { join } from 'node:path'
import type { DownloadItem } from '../contracts.ts'
import type { AssetIndex, AssetIndexEntry, RawVersionJson } from './types.ts'
import { resolveLibrary, type LibraryEnvironment } from './maven.ts'
import { evaluateRules, type RuleEnvironment } from './rules.ts'

/** Official object store for game assets. */
export const DEFAULT_ASSET_URL = 'https://resources.download.minecraft.net'

function stripSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url
}

/** A file the installer must produce, with its provenance. */
export interface InstallFile extends DownloadItem {
  /** Logical group used for progress messages. */
  group: 'library' | 'native' | 'client' | 'asset' | 'logging'
}

/** Everything the installer has to download for one vanilla version. */
export interface InstallPlan {
  files: InstallFile[]
  totalSize: number
}

/**
 * Path of an asset object on disk ( `assets/objects/<xx>/<sha1>` ).
 *
 * @param assetsRoot — absolute `assets/` directory.
 * @param hash — SHA1 of the object.
 */
export function assetObjectPath(assetsRoot: string, hash: string): string {
  return join(assetsRoot, 'objects', hash.slice(0, 2), hash)
}

/** Path of the asset index (`assets/indexes/<id>.json`). */
export function assetIndexPath(assetsRoot: string, id: string): string {
  return join(assetsRoot, 'indexes', `${id}.json`)
}

/** Path of the client jar of a version (`versions/<id>/<id>.jar`). */
export function clientJarPath(versionsRoot: string, id: string): string {
  return join(versionsRoot, id, `${id}.jar`)
}

/** Path of a version json (`versions/<id>/<id>.json`). */
export function versionJsonPath(versionsRoot: string, id: string): string {
  return join(versionsRoot, id, `${id}.json`)
}

/**
 * Build the download plan for a vanilla version.
 *
 * @param json — the fully resolved version json.
 * @param roots — absolute data directories.
 * @param env — rule environment (the machine the game will run on).
 * @param assetIndex — the fetched asset index, when already available.
 * @param assetsBaseUrl — object store base url (`mirrors.assets`).
 */
export function buildInstallPlan(
  json: RawVersionJson,
  roots: { versions: string; libraries: string; assets: string },
  env: RuleEnvironment,
  assetIndex?: AssetIndex,
  assetsBaseUrl = DEFAULT_ASSET_URL,
): InstallPlan {
  const files: InstallFile[] = []
  const libraryEnv: LibraryEnvironment = {
    osName: env.os.name,
    arch: env.os.arch,
    bits: env.os.arch === 'x86' || env.os.arch === 'arm32' ? '32' : '64',
  }

  for (const library of json.libraries ?? []) {
    if (!evaluateRules(library.rules, env)) continue
    const resolved = resolveLibrary(library, roots.libraries, libraryEnv)
    if (!resolved?.url) continue
    files.push({
      url: resolved.url,
      destination: resolved.path,
      sha1: resolved.sha1,
      size: resolved.size,
      group: resolved.native ? 'native' : 'library',
    })
  }

  const client = json.downloads?.['client']
  if (client?.url) {
    files.push({
      url: client.url,
      destination: clientJarPath(roots.versions, json.id),
      sha1: client.sha1,
      size: client.size,
      group: 'client',
    })
  }

  const logging = json.logging?.client
  if (logging?.file?.url) {
    files.push({
      url: logging.file.url,
      destination: join(roots.assets, 'log_configs', logging.file.id),
      sha1: logging.file.sha1,
      size: logging.file.size,
      group: 'logging',
    })
  }

  if (assetIndex) {
    // Asset objects are content addressed: the SHA1 is also the file name, so
    // two index keys pointing at the same object share one download.
    const seen = new Set<string>()
    for (const entry of Object.values(assetIndex.objects)) {
      if (seen.has(entry.hash)) continue
      seen.add(entry.hash)
      files.push({
        url: `${stripSlash(assetsBaseUrl)}/${entry.hash.slice(0, 2)}/${entry.hash}`,
        destination: assetObjectPath(roots.assets, entry.hash),
        sha1: entry.hash,
        size: entry.size,
        group: 'asset',
      })
    }
  }

  const totalSize = files.reduce((sum, file) => sum + (file.size ?? 0), 0)
  return { files, totalSize }
}

/** Download entry of the asset index file itself. */
export function assetIndexFile(json: RawVersionJson, assetsRoot: string): InstallFile | undefined {
  const index = json.assetIndex
  if (!index?.url) return undefined
  return {
    url: index.url,
    destination: assetIndexPath(assetsRoot, index.id),
    sha1: index.sha1,
    size: index.size,
    group: 'asset',
  }
}

/** Group counts used for progress messages. */
export function summarize(files: InstallFile[]): Record<InstallFile['group'], number> {
  const out: Record<InstallFile['group'], number> = {
    library: 0,
    native: 0,
    client: 0,
    asset: 0,
    logging: 0,
  }
  for (const file of files) out[file.group]++
  return out
}

/** Normalise an asset index body into its object map. */
export function parseAssetIndex(raw: unknown): AssetIndex | undefined {
  if (!raw || typeof raw !== 'object') return undefined
  const objects = (raw as { objects?: unknown }).objects
  if (!objects || typeof objects !== 'object') return undefined
  const out: Record<string, AssetIndexEntry> = {}
  for (const [name, value] of Object.entries(objects as Record<string, unknown>)) {
    const entry = value as { hash?: unknown; size?: unknown }
    if (typeof entry?.hash !== 'string') continue
    out[name] = { hash: entry.hash, size: typeof entry.size === 'number' ? entry.size : 0 }
  }
  return { objects: out }
}
