import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import { randomUUID } from 'node:crypto'
import type { Instance, ModFile, ModUpdateInfo } from '../../types.ts'
import type { RhPaths } from '../../contracts.ts'
import { check, directory, fail, fingerprint, inside, targetPath, type Hashes, type Snapshot } from '../../modpack/safety.ts'
import { modName } from '../../services/mods.ts'
import { join } from 'node:path'

export type UpdateSource = 'modrinth' | 'curseforge'
export interface UpdateResult extends Partial<ModUpdateInfo> {
  diskName: string
  source: UpdateSource
  status: 'update' | 'current' | 'unknown' | 'error'
  updateId?: string
  hashes?: Hashes
  size?: number
  currentHash?: string
  error?: { code: string; message: string }
}
export interface LocalMod { mod: ModFile; path: string; snapshot: Snapshot }
export interface Proposal {
  id: string; instanceId: string; diskName: string; source: UpdateSource; expires: number
  old: Snapshot; downloadUrl: string; fileName: string; hashes: Hashes; size: number
  latestVersion: string; latestVersionId: string
}
export function proposals(env: FeatureEnvironment): Map<string, Proposal> {
  return env.state('content.update-proposals', () => new Map<string, Proposal>())
}
export async function localMods(instanceId: string, source: UpdateSource, env: FeatureEnvironment): Promise<{ instance: Instance; mods: LocalMod[]; results: UpdateResult[] }> {
  check(env)
  const instance = await env.use<Instance | undefined>('instance.get', { id: instanceId })
  if (!instance) fail('实例不存在：' + instanceId, 'NOT_FOUND', 404)
  const paths = await env.use<RhPaths>('paths.get')
  inside(paths.instances, instance.path)
  await directory(instance.path)
  const files = await env.use<Promise<ModFile[]>>('mod.list', { id: instanceId })
  const mods: LocalMod[] = [], results: UpdateResult[] = []
  for (const mod of files) {
    check(env)
    try {
      const path = await targetPath(join(instance.path, 'mods'), modName(mod.diskName))
      const snapshot = await fingerprint(path, env, ['sha1', 'sha256', 'sha512', 'md5'])
      mods.push({ mod, path, snapshot })
    } catch (error) { check(env); results.push(errorResult(mod, source, error)) }
  }
  return { instance, mods, results }
}
export function result(mod: ModFile, source: UpdateSource, status: UpdateResult['status']): UpdateResult {
  return { diskName: mod.diskName, modId: mod.meta?.id, currentVersion: mod.meta?.version, source, status }
}
export function errorResult(mod: ModFile, source: UpdateSource, error: unknown, status: 'error' | 'unknown' = 'error'): UpdateResult {
  return { ...result(mod, source, status), error: { code: error instanceof FeatureError ? error.code : 'UPDATE_CHECK_FAILED', message: error instanceof Error ? error.message : String(error) } }
}
export function issue(env: FeatureEnvironment, instanceId: string, local: LocalMod, source: UpdateSource, file: { url: string; fileName: string; hashes: Hashes; size: number }, latestVersion: string, latestVersionId: string): UpdateResult {
  const store = proposals(env)
  for (const [id, proposal] of store) if (proposal.expires < Date.now()) store.delete(id)
  while (store.size >= 1000) store.delete(store.keys().next().value!)
  const id = randomUUID()
  store.set(id, { id, instanceId, diskName: local.mod.diskName, source, expires: Date.now() + 15 * 60 * 1000, old: structuredClone(local.snapshot), downloadUrl: file.url, fileName: file.fileName, hashes: { ...file.hashes }, size: file.size, latestVersion, latestVersionId })
  return { ...result(local.mod, source, 'update'), updateId: id, latestVersion, latestVersionId, downloadUrl: file.url, fileName: file.fileName, hashes: { ...file.hashes }, size: file.size, currentHash: local.snapshot.hashes.sha256 }
}
export function date(value: unknown): number {
  const date = typeof value === 'string' ? Date.parse(value) : NaN
  if (!Number.isFinite(date)) fail('远端版本日期无效', 'INVALID_RESPONSE', 502)
  return date
}
