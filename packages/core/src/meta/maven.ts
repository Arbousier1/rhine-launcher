/**
 * Maven coordinate parsing and library path construction for Minecraft
 * version jsons.
 *
 * The rules mirror the official launcher and HMCL's `Artifact`/`Library`:
 * a library name is `group:artifact:version[:classifier][@extension]`, and the
 * on-disk path follows the maven repository layout.
 */
import { join } from 'node:path'
import type { RawLibrary } from '../contracts.ts'

/** Default maven repository used when a library has no explicit `url`. */
export const DEFAULT_LIBRARY_URL = 'https://libraries.minecraft.net/'

/** Parsed `group:artifact:version[:classifier][@extension]` coordinate. */
export interface MavenCoordinate {
  group: string
  artifact: string
  version: string
  classifier?: string
  extension: string
}

/**
 * Parse a maven coordinate.
 *
 * @param name — the library `name` field of a version json.
 * @returns the parsed coordinate, or `undefined` when the name is malformed.
 */
export function parseMavenCoordinate(name: string): MavenCoordinate | undefined {
  if (typeof name !== 'string' || !name.includes(':')) return undefined
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

/** Maven repository path for a coordinate, POSIX separators. */
export function coordinatePath(coordinate: MavenCoordinate): string {
  const { group, artifact, version, classifier, extension } = coordinate
  const fileName = classifier
    ? `${artifact}-${version}-${classifier}.${extension}`
    : `${artifact}-${version}.${extension}`
  return [group.replace(/\./g, '/'), artifact, version, fileName].join('/')
}

/** Absolute path inside a maven root for a coordinate. */
export function coordinateFile(root: string, coordinate: MavenCoordinate): string {
  return join(root, ...coordinatePath(coordinate).split('/'))
}

/** Native descriptor keys, including the `native-`/`natives-` variants (HMCL compatible). */
export function nativeDescriptors(osName: string, arch: string, bits: '32' | '64'): string[] {
  const keys = ['', arch, bits]
  const variants = ['', 'native', 'natives']
  const out: string[] = []
  for (const key of keys) {
    for (const variant of variants) {
      let descriptor = variant ? `${variant}-` : ''
      descriptor += osName
      if (key) descriptor += `-${key}`
      out.push(descriptor)
    }
  }
  return out
}

/** A library resolved into concrete download metadata. */
export interface ResolvedLibrary {
  name: string
  /** True when this entry must be extracted from a native jar. */
  native: boolean
  /** Maven classifier for the artefact (also set for natives). */
  classifier?: string
  /** Absolute path inside the libraries directory. */
  path: string
  /** Download url, or `undefined` when the library ships with the game. */
  url?: string
  sha1?: string
  size?: number
  /** Extraction rules for natives. */
  extract?: { exclude?: string[] }
  /** Repository base url of the library entry. */
  repository: string
}

/** Environment used when resolving libraries. */
export interface LibraryEnvironment {
  osName: string
  arch: string
  bits: '32' | '64'
}

/**
 * Pick the native classifier of a library for the given environment.
 *
 * Modern jsons use `downloads.classifiers` keyed by descriptor; legacy jsons
 * use a `natives` map whose value still contains the arch placeholder.
 */
export function nativeClassifier(library: RawLibrary, env: LibraryEnvironment): string | undefined {
  const keys = nativeDescriptors(env.osName, env.arch, env.bits)
  if (library.natives) {
    for (const key of keys) {
      const value = library.natives[key]
      if (value !== undefined) return value.replace('${arch}', env.bits)
    }
    return undefined
  }
  const classifiers = library.downloads?.classifiers
  if (classifiers) {
    for (const key of keys) {
      if (classifiers[key]) return key
    }
  }
  return undefined
}

/** True when the library ships platform specific natives. */
export function isNativeLibrary(library: RawLibrary, env: LibraryEnvironment): boolean {
  if (library.natives) return true
  const classifiers = library.downloads?.classifiers
  if (!classifiers) return false
  return Object.keys(classifiers).some((key) => key.startsWith('native'))
}

/** Normalise a repository url to end with a slash. */
export function normalizeRepository(url: string | undefined): string {
  const base = url && url.trim() ? url.trim() : DEFAULT_LIBRARY_URL
  return base.endsWith('/') ? base : base + '/'
}

/**
 * Resolve one version-json library entry into a concrete download.
 *
 * @param library — raw library entry.
 * @param librariesRoot — absolute `libraries/` directory.
 * @param env — target environment, used to pick native classifiers.
 */
export function resolveLibrary(
  library: RawLibrary,
  librariesRoot: string,
  env: LibraryEnvironment,
): ResolvedLibrary | undefined {
  const coordinate = parseMavenCoordinate(library.name)
  if (!coordinate) return undefined

  const natives = isNativeLibrary(library, env)
  const classifier = natives ? nativeClassifier(library, env) : undefined
  const repository = normalizeRepository(library.url)
  const raw = natives
    ? classifier && library.downloads?.classifiers
      ? library.downloads.classifiers[classifier]
      : undefined
    : library.downloads?.artifact

  const effective: MavenCoordinate = {
    ...coordinate,
    classifier: classifier ?? coordinate.classifier,
  }
  const path = raw?.path ?? coordinatePath(effective)
  const url = raw?.url ?? repository + path

  return {
    name: library.name,
    native: natives,
    classifier: effective.classifier,
    path: join(librariesRoot, ...path.split('/')),
    url,
    sha1: raw?.sha1,
    size: raw?.size,
    extract: library.extract,
    repository,
  }
}

/** Deduplicate libraries by `name`; later entries overwrite earlier ones. */
export function mergeLibraries(
  base: RawLibrary[] | undefined,
  overlay: RawLibrary[] | undefined,
): RawLibrary[] {
  const out: RawLibrary[] = []
  const index = new Map<string, number>()
  for (const library of [...(base ?? []), ...(overlay ?? [])]) {
    const key = library?.name
    if (!key) continue
    const existing = index.get(key)
    if (existing === undefined) {
      index.set(key, out.length)
      out.push(library)
    } else {
      out[existing] = library
    }
  }
  return out
}

/** Deduplicate items while preserving first-seen order. */
export function uniqueBy<T>(items: T[], key: (item: T) => string): T[] {
  const seen = new Set<string>()
  const out: T[] = []
  for (const item of items) {
    const id = key(item)
    if (seen.has(id)) continue
    seen.add(id)
    out.push(item)
  }
  return out
}
