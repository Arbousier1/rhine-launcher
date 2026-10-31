/**
 * Loader metadata helpers shared by the fabric/quilt/forge/neoforge paths.
 *
 * Everything here is pure: HTTP fetching lives in the service, so the parsing
 * and version-normalisation rules can be unit tested against recorded payloads.
 */
import type { LoaderKind, LoaderVersion } from '../types.ts'

/** A fabric/quilt "profile json" as returned by their meta services. */
export interface LoaderProfile {
  id: string
  inheritsFrom?: string
  mainClass?: string
  libraries?: { name: string; url?: string; [key: string]: unknown }[]
  arguments?: Record<string, unknown>
  [key: string]: unknown
}

/** One entry of `/v2/versions/loader/<game>`. */
export interface FabricLoaderEntry {
  loader: { version: string; stable?: boolean; maven?: string }
  intermediary?: { version?: string }
  launcherMeta?: { version?: number }
}

/** One entry of `/v3/versions/loader/<game>` (quilt reports `separator` too). */
export interface QuiltLoaderEntry {
  loader: { version: string; stable?: boolean; maven?: string }
  hashed?: unknown
}

/** Build the canonical version id for a fabric/quilt style loader install. */
export function loaderVersionId(kind: LoaderKind, loaderVersion: string, gameVersion: string): string {
  switch (kind) {
    case 'fabric':
      return `fabric-loader-${loaderVersion}-${gameVersion}`
    case 'quilt':
      return `quilt-loader-${loaderVersion}-${gameVersion}`
    case 'forge':
      return `${gameVersion}-forge-${loaderVersion}`
    case 'neoforge':
      return `neoforge-${loaderVersion}`
    case 'optifine':
      return `${gameVersion}-OptiFine_${loaderVersion}`
    case 'liteloader':
      return `${gameVersion}-LiteLoader`
    default:
      return gameVersion
  }
}

/**
 * Convert fabric/quilt meta entries into the shared {@link LoaderVersion} list.
 *
 * Entries are returned newest-first, which is the order their meta services
 * already use; `stable` is surfaced separately because fabric publishes beta
 * loaders in the same list.
 */
export function toLoaderVersions(
  entries: (FabricLoaderEntry | QuiltLoaderEntry)[] | undefined,
  gameVersion: string,
): LoaderVersion[] {
  if (!Array.isArray(entries)) return []
  const out: LoaderVersion[] = []
  for (const entry of entries) {
    const version = entry?.loader?.version
    if (!version) continue
    out.push({
      version,
      type: entry.loader.stable === false ? 'beta' : 'release',
      gameVersion,
      stable: entry.loader.stable !== false,
    })
  }
  return out
}

/**
 * Normalise a loader profile json into a version json that can be written to
 * `versions/<id>/<id>.json`.
 *
 * The build services already return an almost complete version json; the only
 * adjustments are a stable `id` and an explicit `inheritsFrom` so the metadata
 * service can resolve the vanilla chain.
 */
export function normalizeProfile(
  kind: LoaderKind,
  profile: LoaderProfile,
  gameVersion: string,
  loaderVersion: string,
): LoaderProfile {
  return {
    ...profile,
    id: loaderVersionId(kind, loaderVersion, gameVersion),
    inheritsFrom: profile.inheritsFrom ?? gameVersion,
    type: profile['type'] ?? 'release',
  }
}

/**
 * Pick the first loader version that matches a constraint prefix.
 *
 * Used by the UI's "just install the latest stable" path and by detection.
 */
export function latestStable(versions: LoaderVersion[]): LoaderVersion | undefined {
  return versions.find((version) => version.stable !== false) ?? versions[0]
}

/** True when `id` looks like an installed loader version for `kind`. */
export function matchesLoaderId(kind: LoaderKind, id: string): boolean {
  switch (kind) {
    case 'fabric':
      return /^fabric-loader-/.test(id)
    case 'quilt':
      return /^quilt-loader-/.test(id)
    case 'forge':
      return /-forge-/.test(id)
    case 'neoforge':
      return /^neoforge-/.test(id)
    case 'optifine':
      return /OptiFine/i.test(id)
    case 'liteloader':
      return /LiteLoader/i.test(id)
    default:
      return false
  }
}

/**
 * Extract the loader version out of an installed version id.
 *
 * @example extractLoaderVersion('fabric', 'fabric-loader-0.16.9-1.20.1', '1.20.1') // '0.16.9'
 */
export function extractLoaderVersion(kind: LoaderKind, id: string, gameVersion: string): string | undefined {
  switch (kind) {
    case 'fabric': {
      const match = /^fabric-loader-(.+)-([^-]+(?:\.[^-]+)*)$/.exec(id)
      return match ? match[1].replace(new RegExp(`-${escapeRegExp(gameVersion)}$`), '') : undefined
    }
    case 'quilt': {
      if (!id.startsWith('quilt-loader-')) return undefined
      const body = id.slice('quilt-loader-'.length)
      return body.endsWith(`-${gameVersion}`) ? body.slice(0, -(gameVersion.length + 1)) : body
    }
    case 'forge': {
      const prefix = `${gameVersion}-forge-`
      return id.startsWith(prefix) ? id.slice(prefix.length) : undefined
    }
    case 'neoforge':
      return id.startsWith('neoforge-') ? id.slice('neoforge-'.length) : undefined
    case 'optifine': {
      const match = /OptiFine[_-](.+)$/i.exec(id)
      return match ? match[1] : undefined
    }
    default:
      return undefined
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Split a forge maven version (`1.20.1-47.2.0`) into game and loader parts.
 *
 * Forge publishes either `<mc>-<loader>` or, for very old versions, a bare
 * loader version; the game version is needed to filter the list per game.
 */
export function parseForgeVersion(version: string): { gameVersion?: string; loaderVersion: string } {
  const match = /^(\d+\.\d+(?:\.\d+)?(?:[-_][0-9A-Za-z]+)*)-(.+)$/.exec(version)
  if (!match) return { loaderVersion: version }
  return { gameVersion: match[1], loaderVersion: match[2] }
}

/**
 * Derive the Minecraft version of a NeoForge artefact version.
 *
 * Mirrors HMCL's `NeoForgeRemoteVersion`: `20.4.237` is 1.20.4, `21.0.167`
 * is 1.21, while `1.20.1-47.1.90` (the transitional naming) carries the game
 * version inline.
 */
export function parseNeoForgeGameVersion(version: string): string | undefined {
  if (version.startsWith('1.20.1-')) return '1.20.1'
  const parts = version.split('.')
  if (parts.length < 3) return undefined
  const major = Number.parseInt(parts[0], 10)
  if (!Number.isFinite(major)) return undefined
  if (major === 0) return parts.slice(1).join('.')
  if (major >= 26) {
    // 26.x.y may be "26.3.0-beta" where a zero patch folds into 26.3.
    const [a, b, c] = parts.map((part) => Number.parseInt(part.split('-')[0], 10))
    if (Number.isFinite(c) && c === 0) return `${a}.${b}`
    return `${a}.${b}.${c}`
  }
  const minor = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(minor)) return undefined
  return minor === 0 ? `1.${major}` : `1.${major}.${minor}`
}

/** True when a NeoForge artefact version is a beta/alpha build. */
export function neoForgeType(version: string): LoaderVersion['type'] {
  return /beta|alpha/i.test(version) ? 'snapshot' : 'release'
}

/** Keep only the NeoForge versions that belong to a game version. */
export function filterNeoForgeVersions(versions: string[], gameVersion: string): LoaderVersion[] {
  const out: LoaderVersion[] = []
  for (const version of versions) {
    if (parseNeoForgeGameVersion(version) !== gameVersion) continue
    out.push({
      version: normalizeNeoForgeVersion(version),
      type: neoForgeType(version),
      gameVersion,
      stable: neoForgeType(version) === 'release',
    })
  }
  return out
}

export interface MultiMcNeoForgeEntry {
  version: string
  requires?: { equals?: string; uid: string }[]
}

export interface BmclapiOptiFineEntry {
  filename?: string
  mcversion: string
  patch: string
  type: string
  forge?: string
}

/** Convert BMCLAPI OptiFine entries into LoaderVersion items. */
export function toOptiFineLoaderVersions(
  entries: BmclapiOptiFineEntry[] | undefined,
  gameVersion: string,
): LoaderVersion[] {
  if (!Array.isArray(entries)) return []
  return entries.map((e) => ({
    version: `${e.type}_${e.patch}`,
    type: 'release',
    gameVersion,
    notes: e.filename ? (`${e.filename}` + (e.forge ? ` (${e.forge})` : '')) : undefined,
    stable: true,
  }))
}

/** Parse NeoForge builds from the Prism/MultiMC index format. */
export function parseMultiMcNeoForgeVersions(
  entries: MultiMcNeoForgeEntry[],
  gameVersion: string,
): LoaderVersion[] {
  const matching = entries.filter((e) =>
    e.requires?.some((r) => r.uid === 'net.minecraft' && r.equals === gameVersion)
    || parseNeoForgeGameVersion(e.version) === gameVersion
  )
  return matching.map((e) => ({
    version: normalizeNeoForgeVersion(e.version),
    type: neoForgeType(e.version),
    gameVersion,
    stable: neoForgeType(e.version) === 'release',
  }))
}

/** Strip the transitional `1.20.1-` / `1.20.1-forge-` prefix from NeoForge versions. */
export function normalizeNeoForgeVersion(version: string): string {
  if (version.startsWith('1.20.1-forge-')) return version.slice('1.20.1-forge-'.length)
  if (version.startsWith('1.20.1-')) return version.slice('1.20.1-'.length)
  return version
}

/**
 * Extract `<version>` values from a maven `maven-metadata.xml`.
 *
 * A hand written parser is enough here: the document is flat, machine generated
 * and never contains CDATA or namespaces we care about, and pulling in an XML
 * dependency is not allowed.
 */
export function parseMavenMetadata(xml: string): string[] {
  const versions: string[] = []
  const pattern = /<version>([^<]+)<\/version>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const value = match[1].trim()
    if (value) versions.push(value)
  }
  return versions
}

/** Filter a forge metadata version list down to one game version. */
export function filterForgeVersions(versions: string[], gameVersion: string): LoaderVersion[] {
  const out: LoaderVersion[] = []
  for (const version of versions) {
    const parsed = parseForgeVersion(version)
    if (parsed.gameVersion !== gameVersion) continue
    out.push({
      version: parsed.loaderVersion,
      type: /beta/i.test(parsed.loaderVersion) ? 'beta' : 'release',
      gameVersion,
      stable: !/beta/i.test(parsed.loaderVersion),
    })
  }
  return out
}

/**
 * Forge publishes promoted builds on `files.minecraftforge.net`; when that list
 * is unavailable the plain maven order is used. This keeps only unique loader
 * versions while preserving the upstream (newest first) ordering.
 */
export function dedupeLoaderVersions(versions: LoaderVersion[]): LoaderVersion[] {
  const seen = new Set<string>()
  const out: LoaderVersion[] = []
  for (const version of versions) {
    if (seen.has(version.version)) continue
    seen.add(version.version)
    out.push(version)
  }
  return out
}
