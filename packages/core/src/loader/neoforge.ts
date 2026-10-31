/**
 * NeoForge protocol.
 *
 * Two naming eras coexist:
 *  - Minecraft 1.20.1 builds are published as net.neoforged:forge:1.20.1-47.x and
 *    the installer generates a '1.20.1-forge-47.x' version id;
 *  - Minecraft 1.20.2+ builds are net.neoforged:neoforge:<20.x+> and generate
 *    'neoforge-<version>'.
 *
 * Version lists come from MultiMC's component index, whose entries carry an
 * explicit 'requires net.minecraft == <game>' field; maven metadata is only a
 * fallback and its game mapping is documented as a fallback heuristic.
 */
import { mirrorMavenUrl } from './maven.ts'
import type { LoadedVersionJson } from './types.ts'
import type { LoaderVersion } from '../types.ts'

/** Official NeoForge maven root. */
export const NEOFORGE_MAVEN = 'https://maven.neoforged.net/releases'

/** BMCLAPI maven mirror root. */
export const NEOFORGE_MIRROR_MAVEN = 'https://bmclapi2.bangbang93.com/maven'

/** MultiMC's NeoForge component index (explicit requires per build). */
export const NEOFORGE_INDEX_URLS = ['https://meta.multimc.org/v1/net.neoforged/index.json']

/** One MultiMC component version entry. */
export interface NeoForgeIndexEntry {
  version?: string
  releaseTime?: string
  sha256?: string
  requires?: { uid?: string; equals?: string }[]
}

/** MultiMC component index document. */
export interface NeoForgeIndex {
  versions?: NeoForgeIndexEntry[]
}

/**
 * Parse MultiMC's NeoForge index into loader versions for one game version.
 *
 * Only entries whose explicit 'net.minecraft' requirement equals the requested
 * game version are accepted: no version-string guessing.
 */
export function parseNeoForgeIndex(payload: unknown, gameVersion: string): LoaderVersion[] {
  if (!payload || typeof payload !== 'object') return []
  const entries = (payload as NeoForgeIndex).versions
  if (!Array.isArray(entries)) return []
  const out: LoaderVersion[] = []
  for (const entry of entries) {
    const raw = typeof entry?.version === 'string' ? entry.version.trim() : ''
    if (!raw) continue
    const requiresGame = (entry.requires ?? []).some(
      (requirement) => requirement?.uid === 'net.minecraft' && requirement?.equals === gameVersion,
    )
    if (!requiresGame) continue
    const version = normalizeNeoForgeLoaderVersion(raw, gameVersion)
    if (!version) continue
    const beta = /-(?:beta|alpha)/i.test(version)
    out.push({
      version,
      type: beta ? 'snapshot' : 'release',
      gameVersion,
      stable: !beta,
    })
  }
  const sorted = [...out].sort((left, right) => {
    const rightTime = releaseTimeOf(entries, right.version)
    const leftTime = releaseTimeOf(entries, left.version)
    if (leftTime !== undefined && rightTime !== undefined) return rightTime - leftTime
    return 0
  })
  return dedupeByVersion(sorted)
}

/**
 * Look up the MultiMC index entry for one build (used for its publisher sha256).
 */
export function findNeoForgeIndexEntry(
  payload: unknown,
  gameVersion: string,
  loaderVersion: string,
): NeoForgeIndexEntry | undefined {
  if (!payload || typeof payload !== 'object') return undefined
  const entries = (payload as NeoForgeIndex).versions
  if (!Array.isArray(entries)) return undefined
  return entries.find((entry) => {
    if (typeof entry?.version !== 'string') return false
    if (normalizeNeoForgeLoaderVersion(entry.version.trim(), gameVersion) !== normalizeNeoForgeLoaderVersion(loaderVersion, gameVersion)) {
      return false
    }
    return (entry.requires ?? []).some(
      (requirement) => requirement?.uid === 'net.minecraft' && requirement?.equals === gameVersion,
    )
  })
}

/** Maven artifact that publishes a game version's installer builds. */
export function neoforgeArtifact(gameVersion: string): 'forge' | 'neoforge' {
  return gameVersion === '1.20.1' ? 'forge' : 'neoforge'
}

/** Maven-relative metadata path. */
export function neoforgeMetadataPath(gameVersion: string): string {
  return 'net/neoforged/' + neoforgeArtifact(gameVersion) + '/maven-metadata.xml'
}

/** Candidate metadata URLs (official first, BMCLAPI mirror second). */
export function neoforgeMetadataUrls(gameVersion: string): string[] {
  const path = neoforgeMetadataPath(gameVersion)
  return [NEOFORGE_MAVEN + '/' + path, NEOFORGE_MIRROR_MAVEN + '/' + path]
}

/**
 * Maven fallback list parser.
 *
 * The 1.20.1 artifact ('forge') is versioned '1.20.1-47.x'; modern artifacts use
 * '<game-minor>.<game-patch>.<build>' and are mapped back to a game version.
 */
export function parseNeoForgeMavenVersions(xml: string, gameVersion: string): LoaderVersion[] {
  const pattern = /<version>([^<]+)<\/version>/g
  const out: LoaderVersion[] = []
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const raw = match[1].trim()
    if (!raw) continue
    let version: string | undefined
    if (neoforgeArtifact(gameVersion) === 'forge') {
      if (!raw.startsWith(gameVersion + '-')) continue
      version = raw.slice(gameVersion.length + 1)
    } else {
      if (neoForgeGameVersionFromLoader(raw) !== gameVersion) continue
      version = raw
    }
    if (!version) continue
    const beta = /-(?:beta|alpha)/i.test(version)
    out.push({
      version,
      type: beta ? 'snapshot' : 'release',
      gameVersion,
      stable: !beta,
    })
  }
  return dedupeByVersion(out).reverse()
}

/** Maven-relative installer path. */
export function neoforgeInstallerPath(gameVersion: string, loaderVersion: string): string {
  const artifact = neoforgeArtifact(gameVersion)
  const version = artifact === 'forge' ? gameVersion + '-' + loaderVersion : loaderVersion
  return 'net/neoforged/' + artifact + '/' + version + '/' + artifact + '-' + version + '-installer.jar'
}

/** Candidate installer URLs (official + BMCLAPI mirror, HTTPS only). */
export function neoforgeInstallerUrls(gameVersion: string, loaderVersion: string): string[] {
  const path = neoforgeInstallerPath(gameVersion, loaderVersion)
  const official = NEOFORGE_MAVEN + '/' + path
  const mirror = NEOFORGE_MIRROR_MAVEN + '/' + path
  const extra = mirrorMavenUrl(official)
  return [...new Set([official, mirror, extra].filter((url): url is string => !!url))]
}

/** Canonical installed id generated by the official installer. */
export function neoforgeVersionId(gameVersion: string, loaderVersion: string): string {
  return neoforgeArtifact(gameVersion) === 'forge'
    ? gameVersion + '-forge-' + loaderVersion
    : 'neoforge-' + loaderVersion
}

/** Extract the loader version from an installed NeoForge id. */
export function neoforgeVersionFromId(id: string, gameVersion?: string): string | undefined {
  if (typeof id !== 'string') return undefined
  if (id.startsWith('neoforge-')) return id.slice('neoforge-'.length) || undefined
  const marker = '-forge-'
  const index = id.indexOf(marker)
  if (index < 0) return undefined
  if (gameVersion && !id.startsWith(gameVersion + marker)) return undefined
  return id.slice(index + marker.length) || undefined
}

/** True when the id is the modern neoforge-<version> scheme. */
export function isNeoForgeVersionId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('neoforge-')
}

/**
 * Classify an installed version json as NeoForge.
 *
 * 1.20.1 builds share Forge's id scheme, so net.neoforged libraries (or a
 * neoforged mainClass) are the authoritative signal.
 */
export function classifyNeoForgeVersion(json: LoadedVersionJson, id: string): { version?: string } | undefined {
  if (typeof id !== 'string') return undefined
  const names = (json.libraries ?? []).map((library) => library?.name ?? '')
  const neoforgedLibrary = names.some((name) => name.startsWith('net.neoforged'))
  const neoforgedMain = typeof json.mainClass === 'string' && /neoforged/i.test(json.mainClass)
  if (!isNeoForgeVersionId(id) && !neoforgedLibrary && !neoforgedMain) return undefined
  const version = neoforgeVersionFromId(id)
  return version ? { version } : {}
}

/**
 * Map a modern NeoForge artefact version back to its Minecraft version.
 *
 * This is the documented fallback heuristic used only when MultiMC's explicit
 * index is unavailable: 20.4.237 -> 1.20.4, 21.1.209 -> 1.21.1 and
 * 26.3.0.97 -> 26.3.
 */
export function neoForgeGameVersionFromLoader(version: string): string | undefined {
  const parts = version.split('.')
  if (parts.length < 3) return undefined
  const major = Number.parseInt(parts[0], 10)
  if (!Number.isFinite(major)) return undefined
  if (major >= 26) return parts[0] + '.' + parts[1]
  const minor = Number.parseInt(parts[1], 10)
  if (!Number.isFinite(minor)) return undefined
  return minor === 0 ? '1.' + major : '1.' + major + '.' + minor
}

/** Strip a leading '<game>-' from a MultiMC/maven loader version. */
export function normalizeNeoForgeLoaderVersion(version: string, gameVersion: string): string {
  const text = (version ?? '').trim()
  if (text.startsWith(gameVersion + '-')) return text.slice(gameVersion.length + 1)
  return text
}

function releaseTimeOf(entries: NeoForgeIndexEntry[], version: string): number | undefined {
  const entry = entries.find((candidate) => normalizeNeoForgeLoaderVersion(candidate?.version ?? '', '') === version)
    ?? entries.find((candidate) => (candidate?.version ?? '').trim() === version)
  if (!entry?.releaseTime) return undefined
  const time = Date.parse(entry.releaseTime)
  return Number.isFinite(time) ? time : undefined
}

function dedupeByVersion(versions: LoaderVersion[]): LoaderVersion[] {
  const seen = new Set<string>()
  const out: LoaderVersion[] = []
  for (const version of versions) {
    if (seen.has(version.version)) continue
    seen.add(version.version)
    out.push(version)
  }
  return out
}
