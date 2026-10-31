/**
 * Forge protocol: maven metadata, installer coordinates and generated ids.
 *
 * Forge installs are a Java installer run against the launcher root. The
 * installer jar embeds install_profile.json plus the final version.json; the
 * loader prefetches that profile first (see maven.ts) and only then executes
 * the installer.
 */
import { mirrorMavenUrl } from './maven.ts'
import type { LoadedVersionJson } from './types.ts'
import type { LoaderVersion } from '../types.ts'

/** Official Forge maven root. */
export const FORGE_MAVEN = 'https://maven.minecraftforge.net'

/** BMCLAPI maven mirror root (serves the same repository layout). */
export const FORGE_MIRROR_MAVEN = 'https://bmclapi2.bangbang93.com/maven'

/** Maven-relative path of Forge's maven-metadata.xml. */
export const FORGE_METADATA_PATH = 'net/minecraftforge/forge/maven-metadata.xml'

/** Parsed Forge maven artefact version. */
export interface ForgeArtefactVersion {
  gameVersion?: string
  loaderVersion: string
}

/**
 * Split a Forge maven version ('1.20.1-47.4.28') into game and loader parts.
 *
 * Very old artefacts carry only a loader version; the game part is optional in
 * that case and the list filter simply ignores the entry.
 */
export function parseForgeArtefactVersion(version: string): ForgeArtefactVersion {
  const match = /^(\d+\.\d+(?:\.\d+)?(?:[-_][0-9A-Za-z.]+)*)-(.+)$/.exec((version ?? '').trim())
  if (!match) return { loaderVersion: (version ?? '').trim() }
  return { gameVersion: match[1], loaderVersion: match[2] }
}

/** Candidate URLs of Forge's maven-metadata.xml (official first, mirror second). */
export function forgeMetadataUrls(): string[] {
  return [
    FORGE_MAVEN + '/' + FORGE_METADATA_PATH,
    FORGE_MIRROR_MAVEN + '/' + FORGE_METADATA_PATH,
  ]
}

/**
 * Filter a Forge maven-metadata.xml body down to one game version.
 *
 * Maven lists versions in ascending order; the UI expects newest first.
 */
export function parseForgeVersions(xml: string, gameVersion: string): LoaderVersion[] {
  const versions: LoaderVersion[] = []
  const pattern = /<version>([^<]+)<\/version>/g
  let match: RegExpExecArray | null
  while ((match = pattern.exec(xml)) !== null) {
    const raw = match[1].trim()
    if (!raw) continue
    const parsed = parseForgeArtefactVersion(raw)
    if (parsed.gameVersion !== gameVersion) continue
    const beta = /beta/i.test(parsed.loaderVersion)
    versions.push({
      version: parsed.loaderVersion,
      type: beta ? 'beta' : 'release',
      gameVersion,
      stable: !beta,
    })
  }
  return dedupeByVersion(versions).reverse()
}

/** Canonical installed version id. */
export function forgeVersionId(gameVersion: string, loaderVersion: string): string {
  return gameVersion + '-forge-' + loaderVersion
}

/** Maven-relative installer path of a Forge build. */
export function forgeInstallerPath(gameVersion: string, loaderVersion: string): string {
  const artefact = gameVersion + '-' + loaderVersion
  return 'net/minecraftforge/forge/' + artefact + '/forge-' + artefact + '-installer.jar'
}

/** Candidate installer URLs (official + BMCLAPI mirror). */
export function forgeInstallerUrls(gameVersion: string, loaderVersion: string): string[] {
  const path = forgeInstallerPath(gameVersion, loaderVersion)
  const urls = [FORGE_MAVEN + '/' + path, FORGE_MIRROR_MAVEN + '/' + path]
  const official = FORGE_MAVEN + '/' + path
  const mirror = mirrorMavenUrl(official)
  if (mirror) urls.push(mirror)
  return [...new Set(urls)]
}

/** Extract the loader version from an installed Forge id. */
export function forgeVersionFromId(id: string, gameVersion?: string): string | undefined {
  const marker = '-forge-'
  const index = typeof id === 'string' ? id.indexOf(marker) : -1
  if (index < 0) return undefined
  if (gameVersion && !id.startsWith(gameVersion + marker)) return undefined
  return id.slice(index + marker.length) || undefined
}

/** True when the id looks like a Forge attachment. */
export function isForgeVersionId(id: string): boolean {
  return typeof id === 'string' && id.includes('-forge-')
}

/**
 * Classify an installed version json as Forge.
 *
 * NeoForge 1.20.1 deliberately reuses the '1.20.1-forge-...' naming scheme, so
 * the presence of net.neoforged libraries wins over the id: such versions must
 * be reported as NeoForge, never as Forge.
 */
export function classifyForgeVersion(json: LoadedVersionJson, id: string): { version?: string } | undefined {
  if (!isForgeVersionId(id)) return undefined
  const names = (json.libraries ?? []).map((library) => library?.name ?? '')
  if (names.some((name) => name.startsWith('net.neoforged'))) return undefined
  if (names.some((name) => name.startsWith('net.neoforged.fancymodloader'))) return undefined
  if (typeof json.mainClass === 'string' && /neoforged/i.test(json.mainClass)) return undefined
  const version = forgeVersionFromId(id)
  return version ? { version } : {}
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
