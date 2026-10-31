/**
 * Shared loader version-list actions.
 *
 * One adapter per protocol so the single-capability list plugins and the legacy
 * repository facade share exactly the same implementation.
 */
import type { LoaderHost } from './capabilities.ts'
import type { LoaderVersion } from '../types.ts'
import { errorMessage, fetchText } from './http.ts'
import { fabricVersionsUrls, parseFabricVersions } from './fabric.ts'
import { parseQuiltVersions, quiltVersionsUrls } from './quilt.ts'
import { forgeMetadataUrls, parseForgeVersions } from './forge.ts'
import {
  NEOFORGE_INDEX_URLS, neoforgeMetadataUrls, parseNeoForgeIndex, parseNeoForgeMavenVersions,
} from './neoforge.ts'
import { optifineListUrls, optifineVersions } from './optifine.ts'

/** List Fabric builds, newest first. */
export async function listFabricVersions(host: LoaderHost, gameVersion: string): Promise<LoaderVersion[]> {
  const response = await fetchText(host, fabricVersionsUrls(gameVersion), 'Fabric 加载器列表', { signal: host.signal })
  return parseFabricVersions(parseJson(response.text, 'Fabric 加载器列表'), gameVersion)
}

/** List Quilt builds, newest first. */
export async function listQuiltVersions(host: LoaderHost, gameVersion: string): Promise<LoaderVersion[]> {
  const response = await fetchText(host, quiltVersionsUrls(gameVersion), 'Quilt 加载器列表', { signal: host.signal })
  return parseQuiltVersions(parseJson(response.text, 'Quilt 加载器列表'), gameVersion)
}

/** List Forge builds, newest first. */
export async function listForgeVersions(host: LoaderHost, gameVersion: string): Promise<LoaderVersion[]> {
  const response = await fetchText(host, forgeMetadataUrls(), 'Forge 版本列表', { signal: host.signal })
  return parseForgeVersions(response.text, gameVersion)
}

/**
 * List NeoForge builds, newest first.
 *
 * MultiMC's index is authoritative because it states the required Minecraft
 * version explicitly. Maven metadata is only consulted when the index fails.
 */
export async function listNeoForgeVersions(host: LoaderHost, gameVersion: string): Promise<LoaderVersion[]> {
  const errors: string[] = []
  try {
    const index = await fetchText(host, NEOFORGE_INDEX_URLS, 'NeoForge 版本列表', { signal: host.signal })
    const fromIndex = parseNeoForgeIndex(parseJson(index.text, 'NeoForge 版本列表'), gameVersion)
    if (fromIndex.length > 0) return fromIndex
  } catch (error) {
    errors.push(errorMessage(error))
  }
  try {
    const metadata = await fetchText(host, neoforgeMetadataUrls(gameVersion), 'NeoForge 版本列表', { signal: host.signal })
    return parseNeoForgeMavenVersions(metadata.text, gameVersion)
  } catch (error) {
    errors.push(errorMessage(error))
  }
  throw new Error('无法获取 NeoForge 版本列表：' + (errors[errors.length - 1] ?? '未知错误'))
}

/** List OptiFine builds (stable editions first, then previews). */
export async function listOptiFineVersions(host: LoaderHost, gameVersion: string): Promise<LoaderVersion[]> {
  const response = await fetchText(host, optifineListUrls(gameVersion), 'OptiFine 版本列表', { signal: host.signal })
  return optifineVersions(parseJson(response.text, 'OptiFine 版本列表'), gameVersion)
}

/** Parse a JSON response with a Chinese error. */
export function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(label + '不是合法的 JSON')
  }
}
