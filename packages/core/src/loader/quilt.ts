/**
 * Quilt loader protocol.
 *
 * Quilt mirrors Fabric's meta API shape (a profile json per game/loader pair);
 * the only differences are the base URL, id prefix and loader naming.
 */
import type { RawVersionJson } from '../contracts.ts'
import type { LoaderVersion } from '../types.ts'
import type { LoadedVersionJson } from './types.ts'

/** One entry of Quilt's loader list. */
export interface QuiltLoaderEntry {
  loader: { version: string; stable?: boolean; maven?: string }
}

/** Official Quilt meta first, then the BMCLAPI mirror when it has the route. */
export const QUILT_META_BASES = [
  'https://meta.quiltmc.org',
  'https://bmclapi2.bangbang93.com/quilt-meta',
] as const

/** Candidate URLs listing Quilt loader builds for a game version. */
export function quiltVersionsUrls(gameVersion: string): string[] {
  return QUILT_META_BASES.map(
    (base) => base + '/v3/versions/loader/' + encodeURIComponent(gameVersion),
  )
}

/** Candidate URLs of a Quilt profile json. */
export function quiltProfileUrls(gameVersion: string, loaderVersion: string): string[] {
  return QUILT_META_BASES.map(
    (base) => base + '/v3/versions/loader/' + encodeURIComponent(gameVersion)
      + '/' + encodeURIComponent(loaderVersion) + '/profile/json',
  )
}

/** Canonical installed version id. */
export function quiltVersionId(gameVersion: string, loaderVersion: string): string {
  return 'quilt-loader-' + loaderVersion + '-' + gameVersion
}

/** Convert Quilt's loader list into the shared LoaderVersion shape. */
export function parseQuiltVersions(payload: unknown, gameVersion: string): LoaderVersion[] {
  if (!Array.isArray(payload)) return []
  const out: LoaderVersion[] = []
  for (const entry of payload as QuiltLoaderEntry[]) {
    const version = entry?.loader?.version?.trim()
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

/** Normalise a Quilt profile into a version json. */
export function normalizeQuiltProfile(payload: unknown, gameVersion: string, loaderVersion: string): RawVersionJson {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Quilt 安装配置格式不正确')
  }
  const profile = payload as RawVersionJson & { id?: string }
  const id = quiltVersionId(gameVersion, loaderVersion)
  if (typeof profile.mainClass !== 'string' || !profile.mainClass) {
    throw new Error('Quilt 安装配置缺少 mainClass')
  }
  return {
    ...profile,
    id,
    inheritsFrom: typeof profile.inheritsFrom === 'string' && profile.inheritsFrom
      ? profile.inheritsFrom
      : gameVersion,
    type: profile.type ?? 'release',
  }
}

/** True when an installed version id names a Quilt loader. */
export function isQuiltVersionId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('quilt-loader-')
}

/** Classify an installed version json as Quilt. */
export function classifyQuiltVersion(json: LoadedVersionJson, id: string): { version?: string } | undefined {
  if (!isQuiltVersionId(id)) return undefined
  const inherits = typeof json.inheritsFrom === 'string' ? json.inheritsFrom : ''
  const version = quiltVersionFromId(id, inherits)
  return version ? { version } : {}
}

/** Extract the loader version out of an installed Quilt version id. */
export function quiltVersionFromId(id: string, gameVersion: string): string | undefined {
  if (!isQuiltVersionId(id)) return undefined
  let body = id.slice('quilt-loader-'.length)
  const suffix = '-' + gameVersion
  if (gameVersion && body.endsWith(suffix)) body = body.slice(0, -suffix.length)
  return body || undefined
}