/**
 * Local structural types for Minecraft metadata files.
 *
 * `contracts.ts` owns the cross-package shapes; the interfaces here describe
 * files this feature parses on its own (asset indexes, manifests) so the
 * parsers stay typed without widening the shared contract.
 */

/** One object inside an asset index. */
export interface AssetIndexEntry {
  hash: string
  size: number
}

/** `assets/indexes/<id>.json`. */
export interface AssetIndex {
  objects: Record<string, AssetIndexEntry>
}

/** Entry of `version_manifest_v2.json`. */
export interface ManifestVersion {
  id: string
  type: 'release' | 'snapshot' | 'old_beta' | 'old_alpha'
  url: string
  time: string
  releaseTime: string
  sha1?: string
  complianceLevel?: number
}

/** `version_manifest_v2.json`. */
export interface VersionManifest {
  latest: { release: string; snapshot: string }
  versions: ManifestVersion[]
}

/**
 * A manifest entry plus the absolute path of the cached version json, used to
 * answer `versionJson()` without a second network round trip.
 */
export interface CachedManifest {
  fetchedAt: number
  manifest: VersionManifest
}

/** `javaVersion` block of a version json. */
export interface GameJavaVersion {
  component: string
  majorVersion: number
}

export type { RawVersionJson } from '../contracts.ts'
