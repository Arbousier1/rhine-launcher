import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { lstat } from 'node:fs/promises'
import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import type { Instance } from '../types.ts'
import type { RhPaths } from '../contracts.ts'
import { check, directory, inside, stagedSource, targetPath } from '../modpack/safety.ts'
import { modName } from '../services/mods.ts'
import { record, text, type OriginalCall } from './feature.ts'
import { findInstance, resourcesState } from './reads.ts'
import { emitOriginal, shared, store } from './state.ts'
import { readResourceMetadataCache, scanResourceDirectory, validCurseforgeId, validModrinthId, type ResourceActionTuple, type ResourceErrorActionTuple, type ResourceFile, type ResourceState } from './resource-state.ts'

interface OriginalResourceState extends ResourceState { __state__: string; id: string }
function fail(message: string, code = 'INVALID_ORIGINAL_CALL', status = 400): never { throw new FeatureError(code, message, status) }
function samePath(a: string, b: string): boolean {
  const left = resolve(a), right = resolve(b)
  return process.platform === 'win32' ? left.toLowerCase() === right.toLowerCase() : left === right
}
function nativePath(value: unknown, label: string): string {
  const path = text(value, label)
  if (!isAbsolute(path) || /[\u0000-\u001f]/.test(path)) fail('A known absolute native path is required; a browser File.name or unknown upload cannot be used as a path', 'NATIVE_PATH_REQUIRED')
  return resolve(path)
}
async function managedInstance(env: FeatureEnvironment, value: unknown): Promise<Instance> {
  const instance = await findInstance(env, nativePath(value, 'instance path'))
  inside(env.use<RhPaths>('paths.get').instances, instance.path)
  await directory(instance.path)
  return instance
}
function list(value: unknown, label: string, max = 2000): unknown[] {
  if (!Array.isArray(value) || value.length > max) fail('Expected ' + label + ' array (at most ' + max + ' items)')
  return value
}
interface ModSelection { instance: Instance; files: string[] }
async function selection(input: OriginalCall, env: FeatureEnvironment): Promise<ModSelection> {
  const options = record(input.args[0], 'mod operation options')
  const instance = await managedInstance(env, options.path)
  const root = join(instance.path, 'mods'), files: string[] = []
  for (const value of list(options.files, 'mod files')) {
    const raw = text(value, 'mod file')
    const path = isAbsolute(raw) ? resolve(raw) : join(root, modName(raw))
    if (!samePath(dirname(path), root)) fail('Mod file does not belong to this managed instance mods directory', 'UNSAFE_PATH')
    const name = modName(basename(path)), target = await targetPath(root, name)
    await lstat(target) // Validate every input before starting this batch's writes.
    if (!files.includes(target)) files.push(target)
  }
  return { instance, files }
}

/** Snapshot only: shared-state leases and filesystem subscriptions are owned by the Lead. */
export async function watchMods(input: OriginalCall, env: FeatureEnvironment): Promise<OriginalResourceState> {
  await managedInstance(env, input.args[0])
  return await resourcesState(input, env, 'mods', 'ellan.mods.watch') as OriginalResourceState
}
async function publishMods(instance: Instance, input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const previous = structuredClone(store(env).states.get('mods:' + instance.id)?.snapshot ?? {}) as Partial<ResourceState>
  const state = await resourcesState({ ...input, args: [instance.path] }, env, 'mods', 'ellan.mods.watch') as OriginalResourceState
  const paths = new Set(state.files.map(file => file.path)), errorPaths = new Set(state.errors.map(error => error.path))
  const updates: ResourceActionTuple[] = []
  for (const file of previous.files ?? []) if (!paths.has(file.path)) updates.push([file.path, 1])
  // Upsert every file, not only changed hashes. The original Vue UI waits for a
  // fresh filesUpdates snapshot even when a metadata refresh changes no values.
  for (const file of state.files) updates.push([structuredClone(file), 0])
  emitOriginal(env, 'commit', [state.id, 'filesUpdates', updates])
  const errors: ResourceErrorActionTuple[] = []
  for (const error of previous.errors ?? []) if (!errorPaths.has(error.path)) errors.push([error.path, 1])
  for (const error of state.errors) if (!(previous.errors ?? []).some(old => old.path === error.path && old.code === error.code)) errors.push([structuredClone(error), 0])
  if (errors.length) emitOriginal(env, 'commit', [state.id, 'errorsUpdates', errors])
}
/** Reparses on-disk metadata plus real persisted source references. No invented market matches. */
export async function refreshModsMetadata(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  await publishMods(await managedInstance(env, input.args[0]), input, env)
}
export async function enableMods(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const { instance, files } = await selection(input, env)
  try { for (const path of files) await env.use('mod.toggle', { id: instance.id, diskName: basename(path), enabled: true }) }
  finally { await publishMods(instance, input, env) }
}
export async function disableMods(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const { instance, files } = await selection(input, env)
  try { for (const path of files) await env.use('mod.toggle', { id: instance.id, diskName: basename(path), enabled: false }) }
  finally { await publishMods(instance, input, env) }
}
export async function uninstallMods(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const { instance, files } = await selection(input, env)
  try { for (const path of files) await env.use('mod.remove', { id: instance.id, diskName: basename(path) }) }
  finally { await publishMods(instance, input, env) }
}
/** Original install is the local-file import API; inputs must be known real native paths. */
export async function installMods(input: OriginalCall, env: FeatureEnvironment): Promise<string[]> {
  const options = record(input.args[0], 'mod import options'), instance = await managedInstance(env, options.path)
  const paths = env.use<RhPaths>('paths.get'), sources: { source: string; name: string }[] = [], names = new Set<string>()
  for (const raw of list(options.files, 'native mod files')) {
    const source = await stagedSource(paths, nativePath(raw, 'native mod file'))
    const name = modName(basename(source)), identity = process.platform === 'win32' ? name.toLowerCase() : name
    if (names.has(identity)) fail('The import batch contains duplicate destination filenames', 'FILE_EXISTS', 409)
    names.add(identity); sources.push({ source, name })
  }
  const installed: string[] = []
  try {
    for (const { source, name } of sources) {
      const target = join(instance.path, 'mods', name)
      if (!samePath(source, target)) await env.use('mod.import', { id: instance.id, path: source, fileName: name })
      installed.push(target)
    }
    return installed
  } finally { await publishMods(instance, input, env) }
}
/** Separate operation/descriptor for hybrid callers using the name import. */
export async function importMods(input: OriginalCall, env: FeatureEnvironment): Promise<string[]> { return installMods(input, env) }
export async function showModsDirectory(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const instance = await managedInstance(env, input.args[0])
  const path = await directory(join(instance.path, 'mods'), true)
  await env.use('system.reveal', { path })
}
/** Reads registered managed instances, not a pretend global resource database. */
export async function searchInstalledMods(input: OriginalCall, env: FeatureEnvironment): Promise<ResourceFile[]> {
  const keyword = text(input.args[0], 'installed mod keyword').toLocaleLowerCase()
  const instances = await env.use<Promise<Instance[]>>('instance.list'), result: ResourceFile[] = []
  for (const instance of instances) {
    const state = await scanResourceDirectory(env, instance)
    for (const file of state.files) if ((file.fileName + ' ' + file.name + ' ' + JSON.stringify(file.metadata)).toLocaleLowerCase().includes(keyword)) result.push(file)
  }
  return result
}

export type InstanceContentGroupType = 'mods' | 'resourcepacks' | 'shaderpacks'
export interface ModGroupData { color: string; files: string[]; icon?: string; pinned?: boolean }
export type ModGroupRules = Record<string, string[]>
function groupType(value: unknown): InstanceContentGroupType {
  if (value === undefined) return 'mods'
  if (value !== 'mods' && value !== 'resourcepacks' && value !== 'shaderpacks') fail('Unsupported instance content group type')
  return value
}
export function normalizeModFileName(path: string): string { return path.replace(/\\/g, '/').split('/').at(-1)!.replace(/\.disabled$/, '') }
function groups(value: unknown): Record<string, ModGroupData> {
  const result: [string, ModGroupData][] = []
  for (const [name, raw] of Object.entries(record(value, 'mod groups'))) {
    text(name, 'group name')
    const group = record(raw, 'mod group')
    if (typeof group.color !== 'string' || group.color.length > 256) fail('Expected group color')
    const files = list(group.files, 'group files', 20000).map(file => text(file, 'group file name'))
    if (group.icon !== undefined && typeof group.icon !== 'string') fail('Expected group icon string')
    if (group.pinned !== undefined && typeof group.pinned !== 'boolean') fail('Expected group pinned boolean')
    result.push([name, { color: group.color, files, ...(typeof group.icon === 'string' ? { icon: group.icon } : {}), ...(typeof group.pinned === 'boolean' ? { pinned: group.pinned } : {}) }])
  }
  return Object.fromEntries(result)
}
function rules(value: unknown): ModGroupRules {
  return Object.fromEntries(Object.entries(record(value, 'shared mod group rules')).map(([name, values]) => {
    text(name, 'rule group name')
    return [name, list(values, 'rule mod IDs', 20000).map(value => text(value, 'rule mod ID'))]
  }))
}
function groupKey(instance: Instance, type: InstanceContentGroupType): string { return 'ModGroups:' + type + ':' + instance.id }
function groupFile(instance: Instance, type: InstanceContentGroupType): string { return join(instance.path, type === 'mods' ? 'mod-groups.json' : type + '-groups.json') }
export function sharedModGroupRulesFile(env: FeatureEnvironment): string { return join(env.use<RhPaths>('paths.get').root, 'shared-mod-group-rules.json') }
async function storageLock<T>(env: FeatureEnvironment, file: string, body: () => Promise<T>): Promise<T> {
  const locks = env.state('ellan.mods.storage-locks', () => new Map<string, Promise<void>>())
  const previous = locks.get(file) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), queued = previous.then(() => gate)
  locks.set(file, queued)
  await previous
  try { check(env); return await body() } finally { release(); if (locks.get(file) === queued) locks.delete(file) }
}
export async function getModGroupState(input: OriginalCall, env: FeatureEnvironment) {
  const instance = await managedInstance(env, input.args[0]), type = groupType(input.args[1])
  const file = await targetPath(instance.path, basename(groupFile(instance, type)))
  const data = groups(await env.use<Promise<unknown>>('storage.read', { file, fallback: {} }))
  return shared(env, groupKey(instance, type), 'InstanceModsGroupState', 'ellan.mod-group.state', input.args, { groups: data }, 'groupsSet')
}
export async function updateModGroups(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const instance = await managedInstance(env, input.args[0]), type = groupType(input.args[2]), data = groups(input.args[1])
  const file = await targetPath(instance.path, basename(groupFile(instance, type)))
  await storageLock(env, file, async () => {
    await env.use('storage.write', { file, value: data })
    const state = shared(env, groupKey(instance, type), 'InstanceModsGroupState', 'ellan.mod-group.state', [instance.path, type], { groups: data }, 'groupsSet')
    emitOriginal(env, 'commit', [state.id, 'groupsSet', structuredClone(data)])
  })
}
export async function getSharedModGroupRules(_input: OriginalCall, env: FeatureEnvironment): Promise<ModGroupRules> {
  return rules(await env.use<Promise<unknown>>('storage.read', { file: sharedModGroupRulesFile(env), fallback: {} }))
}
export async function updateSharedModGroupRules(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const incoming = rules(input.args[0]), replacing = new Set(input.args[1] === undefined ? [] : list(input.args[1], 'replacement groups').map(value => text(value, 'replacement group name')))
  const file = sharedModGroupRulesFile(env)
  await storageLock(env, file, async () => {
    const previous = await getSharedModGroupRules(input, env), visited = new Set<string>(), merged: ModGroupRules = Object.create(null)
    for (const [name, ids] of Object.entries(incoming)) {
      merged[name] = [...new Set(ids)]
      for (const id of ids) visited.add(id)
    }
    for (const [name, ids] of Object.entries(previous)) {
      if (replacing.has(name)) continue
      const entries = merged[name] ?? (merged[name] = [])
      for (const id of ids) if (!visited.has(id)) { entries.push(id); visited.add(id) }
    }
    await env.use('storage.write', { file, value: merged })
  })
}

export interface ProjectMapping { modrinthId: string; curseforgeId: number; name: string; description: string }
export function projectMappingsFile(env: FeatureEnvironment): string { return join(env.use<RhPaths>('paths.get').root, '.rhine', 'ellan-project-mappings.json') }
/** A local, persisted mapping store. Missing global DB means no match, never guessed IDs. */
async function projectMappings(env: FeatureEnvironment): Promise<ProjectMapping[]> {
  const raw = await env.use<Promise<unknown>>('storage.read', { file: projectMappingsFile(env), fallback: [] })
  if (!Array.isArray(raw)) fail('Invalid persisted project mapping data')
  const result = new Map<string, ProjectMapping>()
  for (const entry of raw) {
    const mapping = entry && typeof entry === 'object' ? entry as Record<string, unknown> : undefined
    if (!mapping || !validModrinthId(mapping.modrinthId) || !validCurseforgeId(mapping.curseforgeId) || typeof mapping.name !== 'string' || typeof mapping.description !== 'string') continue
    result.set(mapping.modrinthId + ':' + mapping.curseforgeId, { modrinthId: mapping.modrinthId, curseforgeId: mapping.curseforgeId, name: mapping.name, description: mapping.description })
  }
  // Two explicitly persisted provider references for the same SHA1 are a real
  // identity mapping. One reference or a descriptor's modId is not a mapping.
  const cache = await readResourceMetadataCache(env)
  for (const entry of Object.values(cache)) {
    const mr = entry.metadata?.modrinth, cf = entry.metadata?.curseforge
    if (mr && cf) {
      const key = mr.projectId + ':' + cf.projectId
      if (!result.has(key)) result.set(key, { modrinthId: mr.projectId, curseforgeId: cf.projectId, name: entry.name ?? '', description: '' })
    }
  }
  return [...result.values()]
}
export async function lookupProjectMappings(input: OriginalCall, env: FeatureEnvironment): Promise<ProjectMapping[]> {
  const modrinth = list(input.args[0], 'Modrinth IDs', 1000), curseforge = list(input.args[1], 'CurseForge IDs', 1000)
  if (!modrinth.every(validModrinthId) || !curseforge.every(validCurseforgeId)) fail('Invalid project mapping query IDs')
  const mr = new Set(modrinth), cf = new Set(curseforge)
  return (await projectMappings(env)).filter(mapping => mr.has(mapping.modrinthId) || cf.has(mapping.curseforgeId))
}
export async function lookupProjectByModrinth(input: OriginalCall, env: FeatureEnvironment): Promise<ProjectMapping | undefined> {
  if (!validModrinthId(input.args[0])) fail('Invalid Modrinth project ID')
  return (await projectMappings(env)).find(mapping => mapping.modrinthId === input.args[0])
}
export async function lookupProjectByCurseforge(input: OriginalCall, env: FeatureEnvironment): Promise<ProjectMapping | undefined> {
  if (!validCurseforgeId(input.args[0])) fail('Invalid CurseForge project ID')
  return (await projectMappings(env)).find(mapping => mapping.curseforgeId === input.args[0])
}
export async function lookupProjectByKeyword(input: OriginalCall, env: FeatureEnvironment): Promise<ProjectMapping[]> {
  if (typeof input.args[0] !== 'string' || input.args[0].length > 512) fail('Expected project mapping keyword')
  const keyword = input.args[0].toLocaleLowerCase()
  return (await projectMappings(env)).filter(mapping => (mapping.name + ' ' + mapping.description).toLocaleLowerCase().includes(keyword))
}
