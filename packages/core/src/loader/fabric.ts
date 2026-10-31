/**
 * Fabric loader protocol.
 *
 * Fabric publishes a plain version profile, so installing it is one JSON fetch
 * and an atomic write; no game files are patched.
 */
import type { RawVersionJson } from '../contracts.ts'
import type { LoaderVersion } from '../types.ts'
import type { LoadedVersionJson } from './types.ts'

/** One entry of Fabric's loader list. */
export interface FabricLoaderEntry {
  loader: { version: string; stable?: boolean; maven?: string }
  intermediary?: { version?: string }
}

/** Official Fabric meta, followed by the BMCLAPI mirror. */
export const FABRIC_META_BASES = [
  'https://meta.fabricmc.net',
  'https://bmclapi2.bangbang93.com/fabric-meta',
] as const

/** Candidate URLs listing Fabric loader builds for a game version. */
export function fabricVersionsUrls(gameVersion: string): string[] {
  return FABRIC_META_BASES.map(
    (base) => base + '/v2/versions/loader/' + encodeURIComponent(gameVersion),
  )
}

/** Candidate URLs of a Fabric profile json. */
export function fabricProfileUrls(gameVersion: string, loaderVersion: string): string[] {
  return FABRIC_META_BASES.map(
    (base) => base + '/v2/versions/loader/' + encodeURIComponent(gameVersion)
      + '/' + encodeURIComponent(loaderVersion) + '/profile/json',
  )
}

/** Canonical installed version id. */
export function fabricVersionId(gameVersion: string, loaderVersion: string): string {
  return 'fabric-loader-' + loaderVersion + '-' + gameVersion
}

/** Convert Fabric's loader list into the shared LoaderVersion shape. */
export function parseFabricVersions(payload: unknown, gameVersion: string): LoaderVersion[] {
  if (!Array.isArray(payload)) return []
  const out: LoaderVersion[] = []
  for (const entry of payload as FabricLoaderEntry[]) {
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

/**
 * Normalise a Fabric profile into a version json.
 *
 * @throws Error when the payload is not a usable version json.
 */
export function normalizeFabricProfile(payload: unknown, gameVersion: string, loaderVersion: string): RawVersionJson {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Fabric 安装配置格式不正确')
  }
  const profile = payload as RawVersionJson & { id?: string }
  const id = fabricVersionId(gameVersion, loaderVersion)
  if (typeof profile.mainClass !== 'string' || !profile.mainClass) {
    throw new Error('Fabric 安装配置缺少 mainClass')
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

/** True when an installed version id names a Fabric loader. */
export function isFabricVersionId(id: string): boolean {
  return typeof id === 'string' && id.startsWith('fabric-loader-')
}

/** Classify an installed version json as Fabric. */
export function classifyFabricVersion(json: LoadedVersionJson, id: string): { version?: string } | undefined {
  if (!isFabricVersionId(id)) return undefined
  const inherits = typeof json.inheritsFrom === 'string' ? json.inheritsFrom : ''
  const version = fabricVersionFromId(id, inherits)
  return version ? { version } : {}
}

/** Extract the loader version out of an installed Fabric version id. */
export function fabricVersionFromId(id: string, gameVersion: string): string | undefined {
  if (!isFabricVersionId(id)) return undefined
  let body = id.slice('fabric-loader-'.length)
  const suffix = '-' + gameVersion
  if (gameVersion && body.endsWith(suffix)) body = body.slice(0, -suffix.length)
  return body || undefined
}