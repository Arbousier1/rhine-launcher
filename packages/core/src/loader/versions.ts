/**
 * Installed version discovery and atomic version-json writes.
 *
 * Loader detection reads the version jsons instead of guessing from directory
 * names: NeoForge 1.20.1 reuses Forge's id scheme, and OptiFine can be present
 * as a library in a normal Forge/Fabric profile.
 */
import { mkdir, readdir, readFile, readlink, rename, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import {writeFileAtomic,withFileLock} from '@deepseek-ai/dsh-atomic-write'
import {identifier} from '../plugins/http-input.ts'
import type { LoaderKind, LoaderSpec } from '../types.ts'
import type { LoadedVersionJson, LoaderAttachment } from './types.ts'
import { classifyFabricVersion, fabricVersionFromId } from './fabric.ts'
import { classifyQuiltVersion, quiltVersionFromId } from './quilt.ts'
import { classifyForgeVersion } from './forge.ts'
import { classifyNeoForgeVersion } from './neoforge.ts'
import { classifyOptiFineVersion, optifineVersionFromId } from './optifine.ts'

/** One version directory with a readable json. */
export interface InstalledVersion {
  id: string
  inheritsFrom?: string
  json: LoadedVersionJson
  file: string
}

/** Detection order used for stable UI output. */
export const DETECTION_ORDER: LoaderKind[] = [
  'fabric', 'quilt', 'forge', 'neoforge', 'optifine', 'liteloader',
]

/** Launcher profile stub legacy Forge installers require. */
export const LAUNCHER_PROFILES = {
  profiles: {},
  settings: {},
  version: 3,
}

/** Read every parseable version json below versions/. */
export async function readInstalledVersions(versionsRoot: string): Promise<InstalledVersion[]> {
  let folders: string[]
  try {
    folders = await readdir(versionsRoot)
  } catch {
    return []
  }
  const out: InstalledVersion[] = []
  for (const folder of folders) {
    const file = join(versionsRoot, folder, folder + '.json')
    try {
      const json = JSON.parse(await readFile(file, 'utf8')) as LoadedVersionJson
      const id = typeof json.id === 'string' && json.id ? json.id : folder
      out.push({
        id,
        inheritsFrom: typeof json.inheritsFrom === 'string' ? json.inheritsFrom : undefined,
        json,
        file,
      })
    } catch {
      // Not a version directory, or a corrupt json: ignore it.
    }
  }
  return out
}

/** Read one version json by id. */
export async function readVersionJson(versionsRoot: string, id: string): Promise<LoadedVersionJson | undefined> {
  try {
    return JSON.parse(await readFile(versionJsonFile(versionsRoot, id), 'utf8')) as LoadedVersionJson
  } catch {
    return undefined
  }
}

/** Absolute path of versions/<id>/<id>.json. */
export function versionJsonFile(versionsRoot: string, id: string): string {
  identifier(id,'版本 id')
  return join(versionsRoot, id, id + '.json')
}

/** Absolute path of versions/<id>/<id>.jar. */
export function versionJarFile(versionsRoot: string, id: string): string {
  identifier(id,'版本 id')
  return join(versionsRoot, id, id + '.jar')
}

/** True when versions/<id>/<id>.json exists. */
export async function versionJsonExists(versionsRoot: string, id: string): Promise<boolean> {
  return isFile(versionJsonFile(versionsRoot, id))
}

/** Atomic write of a version json, returning its path. */
export async function writeVersionJson(versionsRoot: string, json: LoadedVersionJson, signal?:AbortSignal): Promise<string> {
  const id = typeof json.id === 'string' ? json.id.trim() : ''
  if (!id) throw new Error('版本 json 缺少 id，无法写入')
  const file = versionJsonFile(versionsRoot, id)
  await mkdir(dirname(file), { recursive: true })
  await withFileLock(file,async()=>{signal?.throwIfAborted();await writeFileAtomic(file,JSON.stringify(json,null,2)+'\n',{mode:0o600,dirMode:0o700})},{signal})
  return file
}

/** Remove a version directory (rollback helper). */
export async function removeVersionDir(versionsRoot: string, id: string): Promise<void> {
  if (!id) return
  identifier(id,'版本 id')
  await rm(join(versionsRoot, id), { recursive: true, force: true })
}

/** True when an installed attachment belongs to a game version. */
export function belongsToGameVersion(
  id: string,
  inheritsFrom: string | undefined,
  gameVersion: string,
): boolean {
  if (!gameVersion) return true
  if (inheritsFrom) return inheritsFrom === gameVersion
  return id === gameVersion || id.endsWith('-' + gameVersion) || id.startsWith(gameVersion + '-')
}

/** Classify one installed version as a loader attachment. */
export function classifyLoaderAttachment(version: InstalledVersion): LoaderAttachment | undefined {
  const id = version.id
  const json = version.json
  const neo = classifyNeoForgeVersion(json, id)
  if (neo) return { kind: 'neoforge', version: neo.version }
  const forge = classifyForgeVersion(json, id)
  if (forge) return { kind: 'forge', version: forge.version }
  const fabric = classifyFabricVersion(json, id)
  if (fabric) return { kind: 'fabric', version: fabric.version ?? fabricVersionFromId(id, version.inheritsFrom ?? '') }
  const quilt = classifyQuiltVersion(json, id)
  if (quilt) return { kind: 'quilt', version: quilt.version ?? quiltVersionFromId(id, version.inheritsFrom ?? '') }
  const optifine = classifyOptiFineVersion(json, id)
  if (optifine) return { kind: 'optifine', version: optifine.version ?? optifineVersionFromId(id) }
  return undefined
}

/** Detect loader attachments for one game version, de-duplicated. */
export function detectLoaderAttachments(versions: InstalledVersion[], gameVersion: string): LoaderSpec[] {
  const seen = new Set<string>()
  const found: LoaderAttachment[] = []
  for (const version of versions) {
    if (!belongsToGameVersion(version.id, version.inheritsFrom, gameVersion)) continue
    const attachment = classifyLoaderAttachment(version)
    if (!attachment) continue
    const key = attachment.kind + ':' + (attachment.version ?? '')
    if (seen.has(key)) continue
    seen.add(key)
    found.push(attachment)
  }
  found.sort((left, right) => DETECTION_ORDER.indexOf(left.kind) - DETECTION_ORDER.indexOf(right.kind))
  return found.map((attachment) =>
    attachment.version ? { kind: attachment.kind, version: attachment.version } : { kind: attachment.kind },
  )
}

/** Absolute path of the vanilla client jar, validated to exist. */
export async function requireClientJar(versionsRoot: string, gameVersion: string): Promise<string> {
  const file = versionJarFile(versionsRoot, gameVersion)
  if (!(await isFile(file))) {
    throw new Error('原版 ' + gameVersion + ' 的客户端 jar 不存在，请先安装原版游戏')
  }
  return file
}

/** Create launcher_profiles.json when legacy installers need it. */
export async function ensureLauncherProfiles(root: string): Promise<void> {
  const file = join(root, 'launcher_profiles.json')
  if (await isFile(file)) return
  await mkdir(root, { recursive: true })
  await writeFile(file, JSON.stringify(LAUNCHER_PROFILES, null, 2) + '\n', 'utf8')
}

/** File size, or undefined when missing. */
export async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size
  } catch {
    return undefined
  }
}

/** True for an existing regular file. */
export async function isFile(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile()
  } catch {
    return false
  }
}

/** Resolve a symlink target for tests/diagnostics. */
export async function readLinkSafe(path: string): Promise<string | undefined> {
  try {
    return await readlink(path)
  } catch {
    return undefined
  }
}
