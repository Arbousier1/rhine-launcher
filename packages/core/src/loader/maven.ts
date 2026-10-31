/**
 * Maven coordinate handling and installer dependency plans.
 *
 * Forge/NeoForge installer jars embed an install_profile.json listing every
 * library, processor classpath entry and data reference the installer needs.
 * The loader prefetches all of them (with HTTPS mirror candidates) before it
 * runs the installer, so a blocked vendor maven or a missing mirror cannot make
 * the installer fetch code by itself.
 */
import { join } from 'node:path'
import { httpsCandidates } from './http.ts'

/** BMCLAPI maven mirror (also proxies Minecraft libraries and Forge/NeoForge artefacts). */
export const BMCLAPI_MAVEN_BASE = 'https://bmclapi2.bangbang93.com/maven/'

/** Maven Central, used for processor-only dependencies. */
export const MAVEN_CENTRAL_BASE = 'https://repo1.maven.org/maven2/'

/** Official Forge maven repository. */
export const FORGE_MAVEN_BASE = 'https://maven.minecraftforge.net/'

/** Official Minecraft libraries repository. */
export const MINECRAFT_LIBRARIES_BASE = 'https://libraries.minecraft.net/'

/** Official NeoForge maven repository (unreachable in some networks; mirror used). */
export const NEOFORGE_MAVEN_BASE = 'https://maven.neoforged.net/releases/'

/** Parsed 'group:artifact:version[:classifier][@extension]' coordinate. */
export interface MavenCoordinate {
  group: string
  artifact: string
  version: string
  classifier?: string
  extension: string
}

/** Parse a maven coordinate, returning undefined for malformed names. */
export function parseMavenCoordinate(name: string | undefined): MavenCoordinate | undefined {
  if (!name || !name.includes(':')) return undefined
  let body = name.trim()
  let extension = 'jar'
  const at = body.indexOf('@')
  if (at >= 0) {
    extension = body.slice(at + 1) || 'jar'
    body = body.slice(0, at)
  }
  const parts = body.split(':')
  if (parts.length < 3) return undefined
  const [group, artifact, version, ...rest] = parts
  if (!group || !artifact || !version) return undefined
  return {
    group,
    artifact,
    version,
    classifier: rest.length ? rest.join(':') : undefined,
    extension,
  }
}

/** Maven repository relative path of a coordinate (POSIX separators). */
export function mavenPath(coordinate: MavenCoordinate): string {
  const fileName = coordinate.classifier
    ? coordinate.artifact + '-' + coordinate.version + '-' + coordinate.classifier + '.' + coordinate.extension
    : coordinate.artifact + '-' + coordinate.version + '.' + coordinate.extension
  return [coordinate.group.replace(/\./g, '/'), coordinate.artifact, coordinate.version, fileName].join('/')
}

/** Absolute destination inside a libraries directory. */
export function mavenDestination(librariesRoot: string, path: string): string {
  return join(librariesRoot, ...path.replace(/\\/g, '/').split('/'))
}

/**
 * Mirror equivalent of an official maven artefact URL.
 *
 * @returns the BMCLAPI URL, or undefined when the host is not mirrored.
 */
export function mirrorMavenUrl(url: string): string | undefined {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return undefined
  }
  if (parsed.protocol !== 'https:') return undefined
  if (parsed.hostname === 'maven.minecraftforge.net' || parsed.hostname === 'libraries.minecraft.net') {
    return BMCLAPI_MAVEN_BASE + parsed.pathname.replace(/^\/+/, '')
  }
  if (parsed.hostname === 'maven.neoforged.net' && parsed.pathname.startsWith('/releases/')) {
    return BMCLAPI_MAVEN_BASE + parsed.pathname.slice('/releases/'.length)
  }
  return undefined
}

/** All HTTPS candidates for an artefact described by a metadata URL and path. */
export function artifactUrls(url: string, path: string | undefined): string[] {
  const mirror = mirrorMavenUrl(url) ?? ''
  // NeoForge's official maven is blocked on some networks; its BMCLAPI mirror is
  // byte-identical, so ask the mirror first and keep the publisher URL as fallback.
  const mirrorFirst = (() => {
    try { return new URL(url).hostname === 'maven.neoforged.net' } catch { return false }
  })()
  const urls = mirrorFirst ? [mirror, url] : [url, mirror]
  if (path) {
    urls.push(
      BMCLAPI_MAVEN_BASE + path,
      MAVEN_CENTRAL_BASE + path,
      MINECRAFT_LIBRARIES_BASE + path,
      FORGE_MAVEN_BASE + path,
    )
  }
  return httpsCandidates(urls)
}

/** All HTTPS candidates for a coordinate that has no URL in the metadata. */
export function coordinateUrls(coordinate: MavenCoordinate): string[] {
  const path = mavenPath(coordinate)
  return httpsCandidates([
    BMCLAPI_MAVEN_BASE + path,
    MAVEN_CENTRAL_BASE + path,
    FORGE_MAVEN_BASE + path,
    NEOFORGE_MAVEN_BASE + path,
    MINECRAFT_LIBRARIES_BASE + path,
  ])
}

/** One file the installer expects to exist locally before it starts. */
export interface InstallerArtifact {
  /** Maven-relative path under libraries/. */
  path: string
  destination: string
  urls: string[]
  sha1?: string
  size?: number
  /** Short label used in progress/errors. */
  label: string
  kind: 'library' | 'processor'
}

/** Library entry shape shared by install_profile.json and version.json. */
export interface InstallerLibrary {
  name?: string
  url?: string
  downloads?: {
    artifact?: { path?: string; url?: string; sha1?: string; size?: number }
  }
}

/** One processor entry of install_profile.json. */
export interface InstallerProcessor {
  sides?: string[]
  jar?: string
  classpath?: string[]
  args?: string[]
  outputs?: Record<string, string>
}

/** install_profile.json (spec 1) shape used by the loader. */
export interface InstallerProfile {
  spec?: number
  profile?: string
  version?: string
  minecraft?: string
  libraries?: InstallerLibrary[]
  processors?: InstallerProcessor[]
  data?: Record<string, Record<string, string>>
  json?: unknown
  [key: string]: unknown
}

/** Minimal version.json shape read from an installer jar. */
export interface InstallerVersionJson {
  id?: string
  inheritsFrom?: string
  mainClass?: string
  libraries?: InstallerLibrary[]
  arguments?: unknown
  minecraftArguments?: string
  [key: string]: unknown
}

/** Canonical version id an installer will produce. */
export function installerVersionId(profile: InstallerProfile | undefined, version: InstallerVersionJson | undefined): string | undefined {
  const id = version?.id ?? profile?.version
  return typeof id === 'string' && id ? id : undefined
}

/** Minecraft version an installer targets. */
export function installerGameVersion(profile: InstallerProfile | undefined, version: InstallerVersionJson | undefined): string | undefined {
  const game = version?.inheritsFrom ?? profile?.minecraft
  return typeof game === 'string' && game ? game : undefined
}

/**
 * Build the prefetch plan of an installer.
 *
 * Only real maven artifacts are listed. Values such as
 * 'client-1.20.1-...-mappings.txt' in install_profile.data are outputs produced
 * by the installer processors (extracted from mcp_config), not downloadable
 * files, so they are intentionally skipped.
 */
export function collectInstallerArtifacts(
  profile: InstallerProfile | undefined,
  version: InstallerVersionJson | undefined,
  librariesRoot: string,
): InstallerArtifact[] {
  const out: InstallerArtifact[] = []
  const byPath = new Map<string, InstallerArtifact>()
  const add = (artifact: InstallerArtifact): void => {
    if (!artifact.path || artifact.urls.length === 0) return
    const known = byPath.get(artifact.path)
    if (known) {
      if (!known.sha1 && artifact.sha1) known.sha1 = artifact.sha1
      if (known.size === undefined && artifact.size !== undefined) known.size = artifact.size
      return
    }
    byPath.set(artifact.path, artifact)
    out.push(artifact)
  }

  for (const library of [...(profile?.libraries ?? []), ...(version?.libraries ?? [])]) {
    const coordinate = parseMavenCoordinate(library?.name)
    const artifact = library?.downloads?.artifact
    const path = artifact?.path ?? (coordinate ? mavenPath(coordinate) : undefined)
    const explicitUrl = artifact?.url
      ?? (library?.url && path ? library.url.replace(/\/+$/, '') + '/' + path : undefined)
      ?? (coordinate ? coordinateUrls(coordinate)[0] : undefined)
    if (!path || !explicitUrl) continue
    const urls = artifact?.url
      ? artifactUrls(artifact.url, path)
      : coordinate
        ? coordinateUrls(coordinate)
        : [...httpsCandidates([explicitUrl, mirrorMavenUrl(explicitUrl) ?? ''])]
    add({
      path,
      destination: mavenDestination(librariesRoot, path),
      urls,
      sha1: artifact?.sha1,
      size: artifact?.size,
      label: path,
      kind: 'library',
    })
  }

  for (const name of processorCoordinates(profile)) {
    const coordinate = parseMavenCoordinate(name)
    if (!coordinate) continue
    const path = mavenPath(coordinate)
    add({
      path,
      destination: mavenDestination(librariesRoot, path),
      urls: coordinateUrls(coordinate),
      label: path,
      kind: 'processor',
    })
  }
  return out
}

/** Every processor dependency coordinate (processor jar plus its classpath). */
export function processorCoordinates(profile: InstallerProfile | undefined): string[] {
  const out = new Set<string>()
  for (const processor of profile?.processors ?? []) {
    if (processor?.sides && !processor.sides.includes('client')) continue
    if (typeof processor?.jar === 'string' && processor.jar) out.add(processor.jar)
    for (const entry of processor?.classpath ?? []) {
      if (typeof entry === 'string' && entry) out.add(entry)
    }
  }
  return [...out]
}

/** Client-side processors of an installer profile. */
export function clientProcessors(profile: InstallerProfile | undefined): InstallerProcessor[] {
  return (profile?.processors ?? []).filter((processor) => !processor?.sides || processor.sides.includes('client'))
}