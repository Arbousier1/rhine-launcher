import { createHash, randomUUID } from 'node:crypto'
import { lstat, mkdir, open, readdir, rename, rm, unlink } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { crc32 } from 'node:zlib'
import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import type { Instance } from '../types.ts'
import type { RhPaths } from '../contracts.ts'
import { check, directory, hashes as validatedHashes, httpUrl, inside, MAX_FILE_BYTES, maybeStat, openRegular, relativePath, size } from '../modpack/safety.ts'
import { taskContext } from '../plugins/task-context.ts'
import { record, text, type OriginalCall } from './feature.ts'
import { marketInstance, verifyMarketReferences } from './market.ts'
import { readResourceMetadataCache, resourceMetadataFile, scanResourceDirectory, sourceMetadata, validCurseforgeId, validModrinthId, type ResourceFolder, type ResourceMetadataCache } from './resource-state.ts'
import { emitOriginal, restoreState, store } from './state.ts'

/** Structural adapter to the actual @xmcl/instance/packages/instance/files.ts schema, NOT
 * Rhine's InstanceFile (name/size/sha1). No runtime import or reference-checkout dependency. */
export interface OriginalInstanceFile {
  path: string
  hashes: Record<string, string>
  downloads?: string[]
  curseforge?: { projectId: number; fileId: number }
  modrinth?: { projectId: string; versionId: string }
  size?: number
}
export interface CommittedFiles { version: 1; updatedAt: number; files: OriginalInstanceFile[] }
interface Snapshot { size: number; ino: number; dev: number; mtimeMs: number; ctimeMs: number; hashes: Record<string, string> }
interface Change { root: string; path: string; target: string; before?: Snapshot; source?: string; staged?: Snapshot; backup: string; backed: boolean; installed: boolean }
const MAX_FILES = 2000, MAX_BATCH_BYTES = 2 * 1024 * 1024 * 1024
const protectedRoots = new Set(['instance.json', '.rhine', '.install', '.install-profile', '.install-profile.tmp', '.install-manifest', 'instance-lock.json', 'instance-lock.json.tmp', 'unresolved-files.json', 'mod-groups.json', 'resourcepacks-groups.json', 'shaderpacks-groups.json'])
function fail(message: string, code = 'INVALID_INSTANCE_MANIFEST', status = 400): never { throw new FeatureError(code, message, status) }
function identity(path: string): string { return path.normalize('NFC').toLowerCase() }
function manifestPath(value: unknown): string {
  const path = relativePath(value)
  if (protectedRoots.has(identity(path.split('/')[0]))) fail('Instance manifests cannot overwrite launcher/install/group metadata', 'UNSAFE_PATH')
  return path
}
function download(value: unknown): string {
  const raw = text(value, 'manifest download URL')
  let url: URL
  try { url = new URL(raw) } catch { return fail('Invalid manifest download URL') }
  if (url.protocol !== 'file:') return httpUrl(raw)
  if ((url.hostname && url.hostname !== 'localhost') || url.username || url.password || url.search || url.hash || !isAbsolute(fileURLToPath(url))) fail('Only an absolute local file URL without authority/credentials is supported', 'UNSAFE_PATH')
  return url.href
}
/** Validate every entry and every portable collision before performing any IO mutation. */
export function validateManifestFiles(value: unknown, label = 'files'): OriginalInstanceFile[] {
  if (!Array.isArray(value) || value.length > MAX_FILES) fail('Expected ' + label + ' array of at most ' + MAX_FILES + ' original InstanceFile entries')
  let total = 0
  const files = value.map(v => {
    const raw = record(v, 'original InstanceFile'), supplied = record(raw.hashes, 'file hashes')
    if (Object.keys(supplied).some(key => !['sha1', 'sha256', 'sha512', 'md5', 'crc32'].includes(key))) fail('Manifest contains an unsupported checksum algorithm')
    const hashes: Record<string, string> = { ...validatedHashes(supplied, false) }
    if (supplied.crc32 !== undefined) {
      if (typeof supplied.crc32 !== 'string' || !/^[0-9]{1,10}$/.test(supplied.crc32) || Number(supplied.crc32) > 0xffffffff) fail('Invalid original decimal CRC32 checksum')
      hashes.crc32 = String(Number(supplied.crc32))
    }
    if (!Object.keys(hashes).length) fail('Every instance file needs a supported verifiable checksum')
    const file: OriginalInstanceFile = { path: manifestPath(raw.path), hashes }
    if (raw.size !== undefined) { file.size = size(raw.size, 'manifest file'); total += file.size; if (total > MAX_BATCH_BYTES) fail('Manifest exceeds the installation byte budget', 'MANIFEST_LIMIT') }
    if (raw.downloads !== undefined) { if (!Array.isArray(raw.downloads) || raw.downloads.length > 32) fail('Invalid manifest downloads'); file.downloads = raw.downloads.map(download) }
    if (raw.modrinth !== undefined) { const ref = record(raw.modrinth); if (!validModrinthId(ref.projectId) || !validModrinthId(ref.versionId)) fail('Invalid original Modrinth source reference'); file.modrinth = { projectId: ref.projectId, versionId: ref.versionId } }
    if (raw.curseforge !== undefined) { const ref = record(raw.curseforge); if (!validCurseforgeId(ref.projectId) || !validCurseforgeId(ref.fileId)) fail('Invalid original CurseForge source reference'); file.curseforge = { projectId: ref.projectId, fileId: ref.fileId } }
    return file
  })
  assertCollisions(files.map(f => f.path))
  return files
}
function assertCollisions(paths: string[]): void {
  const names = paths.map(identity).sort()
  for (let i = 1; i < names.length; i++) if (names[i] === names[i - 1] || names[i].startsWith(names[i - 1] + '/')) fail('Manifest filenames collide, including case aliases or file/directory prefixes', 'FILE_EXISTS', 409)
}
/** No following links, and no case-alias overwrite on a case-sensitive host or Windows. Missing
 * parents are inspected without creating them; creation happens only after all staging succeeds. */
async function safeTarget(root: string, path: string, create = false): Promise<string> {
  const parts = relativePath(path).split('/'), target = inside(root, join(root, ...parts))
  await directory(root)
  let current = resolve(root)
  for (let i = 0; i < parts.length; i++) {
    const names = await readdir(current)
    if (names.some(name => identity(name) === identity(parts[i]) && name !== parts[i])) fail('A live path has a case/Unicode filename alias', 'FILE_EXISTS', 409)
    const next = join(current, parts[i]), info = await maybeStat(next)
    if (!info) {
      if (!create || i === parts.length - 1) return target
      await directory(next, true)
    } else if (info.isSymbolicLink() || (i === parts.length - 1 ? !info.isFile() : !info.isDirectory())) fail('Manifest path contains a link or non-regular destination', 'UNSAFE_PATH')
    current = next
  }
  return target
}
async function snapshot(path: string, env?: Pick<FeatureEnvironment, 'signal' | 'task'>): Promise<Snapshot> {
  check(env)
  const handle = await openRegular(path)
  try {
    const before = await handle.stat(); size(before.size, 'installed/staged file')
    const digests = { sha1: createHash('sha1'), sha256: createHash('sha256'), sha512: createHash('sha512'), md5: createHash('md5') }
    const chunk = Buffer.alloc(128 * 1024); let position = 0, crc = 0
    while (true) {
      check(env)
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
      if (!bytesRead) break
      position += bytesRead
      if (position > MAX_FILE_BYTES) fail('Staged file exceeds the file limit', 'MANIFEST_LIMIT')
      const data = chunk.subarray(0, bytesRead); crc = crc32(data, crc)
      for (const digest of Object.values(digests)) digest.update(data)
    }
    const after = await handle.stat(), named = await lstat(path)
    if (position !== before.size || after.size !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.isSymbolicLink() || named.ino !== before.ino || named.dev !== before.dev) fail('A file changed while it was verified', 'FILE_CHANGED', 409)
    return { size: before.size, ino: before.ino, dev: before.dev, mtimeMs: before.mtimeMs, ctimeMs: before.ctimeMs,
      hashes: { ...Object.fromEntries(Object.entries(digests).map(([key, hash]) => [key, hash.digest('hex')])), crc32: String(crc >>> 0) } }
  } finally { await handle.close() }
}
function matches(file: OriginalInstanceFile, actual: Snapshot): boolean { return (file.size === undefined || file.size === actual.size) && Object.entries(file.hashes).every(([key, value]) => actual.hashes[key] === value) }
function verify(file: OriginalInstanceFile, actual: Snapshot): void { if (!matches(file, actual)) fail('Instance file size/checksum does not match the original manifest: ' + file.path, 'CHECKSUM_MISMATCH', 409) }
function unchanged(a: Snapshot, b: Snapshot): boolean { return a.size === b.size && a.ino === b.ino && a.dev === b.dev && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs && a.hashes.sha256 === b.hashes.sha256 }
async function assertUnchanged(root: string, path: string, before: Snapshot | undefined, env?: Pick<FeatureEnvironment, 'signal' | 'task'>): Promise<string> {
  const target = await safeTarget(root, path), info = await maybeStat(target)
  if (!before ? !!info : !info || !unchanged(before, await snapshot(target, env))) fail('Live destination changed since preflight: ' + path, 'FILE_CHANGED', 409)
  return target
}
async function lock<T>(env: FeatureEnvironment, name: string, key: string, body: () => Promise<T>): Promise<T> {
  const locks = env.state(name, () => new Map<string, Promise<void>>()), previous = locks.get(key) ?? Promise.resolve()
  let release!: () => void
  const gate = new Promise<void>(resolve => { release = resolve }), queued = previous.then(() => gate)
  locks.set(key, queued); await previous
  try { check(env); return await body() } finally { release(); if (locks.get(key) === queued) locks.delete(key) }
}
export function manifestInventoryFile(instancePath: string): string { return join(instancePath, '.rhine', 'ellan-installed-files.json') }
async function localCopy(url: string, target: string, env: FeatureEnvironment): Promise<void> {
  const source = fileURLToPath(url), handle = await openRegular(source)
  let destination: Awaited<ReturnType<typeof open>> | undefined
  try {
    destination = await open(target, 'wx')
    const before = await handle.stat(); size(before.size, 'local manifest source')
    const chunk = Buffer.alloc(128 * 1024); let position = 0
    while (true) { check(env); const read = await handle.read(chunk, 0, chunk.length, position); if (!read.bytesRead) break; position += read.bytesRead; if (position > MAX_FILE_BYTES) fail('Local source exceeds the file limit'); let offset = 0; while (offset < read.bytesRead) { const written = await destination.write(chunk, offset, read.bytesRead - offset); offset += written.bytesWritten } }
    const after = await handle.stat(), named = await lstat(source)
    if (position !== before.size || after.mtimeMs !== before.mtimeMs || after.ctimeMs !== before.ctimeMs || named.isSymbolicLink() || named.ino !== before.ino || named.dev !== before.dev) fail('Local manifest source changed during staging', 'FILE_CHANGED', 409)
    await destination.sync()
  } finally { await handle.close(); await destination?.close() }
}
async function stageFile(file: OriginalInstanceFile, target: string, env: FeatureEnvironment): Promise<Snapshot> {
  if (!file.downloads?.length) fail('Missing download source for an absent/changed file: ' + file.path, 'UNRESOLVED_INSTANCE_FILE', 409)
  let last: unknown
  for (const url of file.downloads) {
    check(env)
    try {
      if (url.startsWith('file:')) await localCopy(url, target, env)
      else await env.use('download.file', { url, destination: target, sha1: file.hashes.sha1, sha256: file.hashes.sha256, sha512: file.hashes.sha512, size: file.size, maxBytes: MAX_FILE_BYTES, retries: 0, skipIfExists: false, signal: taskContext(env).signal })
      const actual = await snapshot(target, env); verify(file, actual); return actual
    } catch (error) {
      last = error
      await safeTarget(dirname(target), basename(target)); await unlink(target).catch(e => { if (e.code !== 'ENOENT') throw e })
      check(env)
    }
  }
  throw last
}
function folderOf(path: string): ResourceFolder | undefined { const first = path.split('/')[0]; return first === 'mods' || first === 'resourcepacks' || first === 'shaderpacks' ? first : undefined }
async function publish(env: FeatureEnvironment, instance: Instance, folders: Set<ResourceFolder>): Promise<void> {
  for (const folder of folders) {
    const value = store(env).states.get(folder + ':' + instance.id)
    if (!value) continue // Do not create a renderer lease or a new watcher for an install.
    const previous = structuredClone(value.snapshot), actual = await scanResourceDirectory(env, instance, folder)
    value.snapshot = { files: actual.files, errors: actual.errors }; restoreState(env, value, previous)
  }
  const install = store(env).states.get('Install:' + instance.id)
  if (install) {
    install.snapshot = { ...install.snapshot, instance: instance.path, pendingFileCount: 0, unresolvedFiles: [] }
    emitOriginal(env, 'commit', [install.id, 'pendingFileCountSet', 0]); emitOriginal(env, 'commit', [install.id, 'unresolvedFilesSet', []])
  }
}
async function assertRoot(root: string, before: { ino: number; dev: number }): Promise<void> {
  await directory(root)
  const actual = await lstat(root)
  if (actual.ino !== before.ino || actual.dev !== before.dev) fail('A checked transaction root was replaced', 'FILE_CHANGED', 409)
}
async function rollback(changes: Change[], roots: Map<string, { ino: number; dev: number }>): Promise<void> {
  const errors: unknown[] = []
  for (const change of [...changes].reverse()) {
    if (!change.backed && !change.installed) continue
    try {
      await assertRoot(change.root, roots.get(change.root)!)
      const target = await safeTarget(change.root, change.path)
      if (change.installed) {
        const actual = await snapshot(target) // Rollback is intentionally not canceled with the task.
        if (!change.staged || actual.ino !== change.staged.ino || actual.dev !== change.staged.dev || actual.hashes.sha256 !== change.staged.hashes.sha256) fail('Refusing to remove a concurrently replaced live file during rollback', 'FILE_CHANGED', 409)
        await unlink(target)
      } else if (await maybeStat(target)) fail('Cannot roll back into an occupied destination', 'FILE_CHANGED', 409)
      if (change.backed) { await safeTarget(dirname(change.backup), basename(change.backup)); const backup = await snapshot(change.backup); if (backup.hashes.sha256 !== change.before?.hashes.sha256) fail('Transaction backup was modified', 'FILE_CHANGED'); await rename(change.backup, target) }
    } catch (error) { errors.push(error) }
  }
  if (errors.length) fail('Rollback could not safely restore every destination; transaction backups were retained', 'ROLLBACK_FAILED', 500)
}

/** Exact original local diff branch. All downloads/hashes/source refs are resolved into staging
 * before any live rename. No pending/resume/upstream API is invented. Returns Promise<void>. */
export async function installInstanceFiles(input: OriginalCall, env: FeatureEnvironment): Promise<void> {
  const options = record(input.args[0], 'InstallInstanceOptions')
  if ('upstream' in options) fail('Upstream/modpack lock installs require their own backend workflow; this operation implements {path,oldFiles,files}', 'UNSUPPORTED_INSTANCE_UPSTREAM')
  if (options.id !== undefined) text(options.id, 'original operation id')
  const instance = await marketInstance(env, options.path), oldFiles = validateManifestFiles(options.oldFiles, 'oldFiles'), files = validateManifestFiles(options.files)
  const old = new Map(oldFiles.map(f => [identity(f.path), f])), next = new Map(files.map(f => [identity(f.path), f]))
  const all = new Map([...old, ...next]); assertCollisions([...all.values()].map(f => f.path))
  // Reject cross-array case-only aliases instead of renaming onto ambiguous filenames.
  for (const file of files) if (old.has(identity(file.path)) && old.get(identity(file.path))!.path !== file.path) fail('oldFiles/files use different case aliases of one destination', 'FILE_EXISTS', 409)
  await lock(env, 'ellan.manifests.instance-locks', identity(resolve(instance.path)), async () => {
    const rootBefore = await lstat(instance.path), before = new Map<string, Snapshot | undefined>(), kept = new Map<string, Snapshot>(), folders = new Set<ResourceFolder>()
    for (const [key, file] of all) {
      check(env)
      const target = await safeTarget(instance.path, file.path), info = await maybeStat(target), actual = info ? await snapshot(target, env) : undefined
      before.set(key, actual)
      const previous = old.get(key), desired = next.get(key)
      if (actual && previous) verify(previous, actual) // Never delete/replace an old file whose bytes changed.
      if (actual && desired && matches(desired, actual)) kept.set(key, actual)
      else if (actual && desired && !previous) fail('Refusing to overwrite a live file not owned by oldFiles: ' + desired.path, 'FILE_EXISTS', 409)
      const folder = folderOf(file.path); if (folder) folders.add(folder)
    }
    const operationId = randomUUID(), stageName = 'ellan-install-' + operationId, staging = join(instance.path, '.rhine', stageName)
    await safeTarget(instance.path, '.rhine/' + stageName + '/probe')
    await directory(dirname(staging), true); await mkdir(staging); const stageBefore = await lstat(staging)
    const staged = new Map<string, Snapshot>(), changes: Change[] = [], globalTemps: { root: string; path: string }[] = []
    let retainBackups = false
    try {
      await directory(join(staging, 'files'), true); await directory(join(staging, 'backups'), true)
      let bytes = 0, count = 0
      for (const [key, file] of next) {
        check(env); env.task?.setProgress({ stage: 'download', current: count, total: files.length, value: files.length ? count / files.length : 1, message: file.path })
        const source = join(staging, 'files', String(count)), actual = kept.get(key) ?? await stageFile(file, source, env)
        bytes += actual.size; if (bytes > MAX_BATCH_BYTES) fail('Verified files exceed the installation byte budget', 'MANIFEST_LIMIT')
        await verifyMarketReferences(env, file, actual)
        staged.set(key, actual)
        if (!kept.has(key)) changes.push({ root: instance.path, path: file.path, target: join(instance.path, ...file.path.split('/')), before: before.get(key), source, staged: actual, backup: join(staging, 'backups', String(changes.length)), backed: false, installed: false })
        count++
      }
      for (const [key, file] of old) if (!next.has(key) && before.get(key)) changes.push({ root: instance.path, path: file.path, target: join(instance.path, ...file.path.split('/')), before: before.get(key), backup: join(staging, 'backups', String(changes.length)), backed: false, installed: false })
      await lock(env, 'ellan.manifests.metadata-locks', resourceMetadataFile(env), async () => {
        const paths = env.use<RhPaths>('paths.get'), cachePath = '.rhine/ellan-resource-metadata.json', inventoryPath = '.rhine/ellan-installed-files.json'
        const cacheTarget = await safeTarget(paths.root, cachePath), inventoryTarget = await safeTarget(instance.path, inventoryPath)
        // Observe JSON baselines BEFORE reads so a concurrent edit cannot be silently overwritten.
        const cacheBefore = await maybeStat(cacheTarget) ? await snapshot(cacheTarget, env) : undefined, inventoryBefore = await maybeStat(inventoryTarget) ? await snapshot(inventoryTarget, env) : undefined
        const roots = new Map<string, { ino: number; dev: number }>([[instance.path, { ino: rootBefore.ino, dev: rootBefore.dev }], [paths.root, await lstat(paths.root)]])
        const cache = await readResourceMetadataCache(env), rawInventory = record(await env.use<Promise<unknown>>('storage.read', { file: manifestInventoryFile(instance.path), fallback: { version: 1, files: [] } }))
        if (rawInventory.version !== 1) fail('Unsupported committed inventory format')
        const previous = validateManifestFiles(rawInventory.files ?? [], 'committed inventory'), inventory = new Map<string, OriginalInstanceFile>()
        for (const file of previous) {
          const key = identity(file.path); if (all.has(key)) continue
          const target = await safeTarget(instance.path, file.path), info = await maybeStat(target)
          if (info) { const actual = await snapshot(target, env); if (matches(file, actual)) inventory.set(key, { ...file, hashes: actual.hashes, size: actual.size }) }
        }
        const updated: ResourceMetadataCache = structuredClone(cache); let metadataChanged = false
        for (const [key, file] of next) {
          const actual = staged.get(key)!, refs = sourceMetadata(file)
          inventory.set(key, { ...file, hashes: { ...actual.hashes }, size: actual.size })
          if (Object.keys(refs).length) { const saved = updated[actual.hashes.sha1] ?? {}; updated[actual.hashes.sha1] = { ...saved, metadata: { ...saved.metadata, ...refs } }; metadataChanged = true }
        }
        const data: CommittedFiles = { version: 1, updatedAt: Date.now(), files: [...inventory.values()].sort((a, b) => a.path.localeCompare(b.path)) }
        validateManifestFiles(data.files, 'committed inventory')
        const inventorySource = join(staging, 'inventory.json'); await env.use('storage.write', { file: inventorySource, value: data })
        changes.push({ root: instance.path, path: inventoryPath, target: inventoryTarget, before: inventoryBefore, source: inventorySource, staged: await snapshot(inventorySource, env), backup: join(staging, 'backups', 'inventory.json'), backed: false, installed: false })
        if (metadataChanged) {
          await directory(join(paths.root, '.rhine'), true)
          const temporary = '.rhine/ellan-resource-' + operationId + '.json', backup = '.rhine/ellan-resource-' + operationId + '.bak'
          const source = await safeTarget(paths.root, temporary)
          globalTemps.push({ root: paths.root, path: temporary }, { root: paths.root, path: backup })
          await env.use('storage.write', { file: source, value: updated })
          changes.push({ root: paths.root, path: cachePath, target: cacheTarget, before: cacheBefore, source, staged: await snapshot(source, env), backup: await safeTarget(paths.root, backup), backed: false, installed: false })
        }
        const registered = await marketInstance(env, instance.path), rootNow = await lstat(instance.path)
        if (registered.id !== instance.id || rootNow.ino !== rootBefore.ino || rootNow.dev !== rootBefore.dev) fail('Registered instance root changed during staging', 'FILE_CHANGED', 409)
        for (const [key, file] of all) await assertUnchanged(instance.path, file.path, before.get(key), env)
        try {
          for (let index = 0; index < changes.length; index++) {
            check(env)
            const change = changes[index]; await assertRoot(change.root, roots.get(change.root)!); await assertUnchanged(change.root, change.path, change.before, env)
            change.target = await safeTarget(change.root, change.path, true)
            if (await maybeStat(change.backup)) fail('Transaction backup path is already occupied', 'FILE_EXISTS', 409)
            if (change.before) { await rename(change.target, change.backup); change.backed = true }
            if (change.source) { await safeTarget(dirname(change.source), basename(change.source)); const actual = await snapshot(change.source, env); if (!change.staged || !unchanged(actual, change.staged)) fail('Staged file changed before commit', 'FILE_CHANGED', 409); await rename(change.source, change.target); change.installed = true }
            env.task?.setProgress({ stage: 'write', current: index + 1, total: changes.length, value: (index + 1) / changes.length, message: change.path })
          }
          check(env); await assertRoot(instance.path, rootBefore); await publish(env, instance, folders)
        } catch (error) {
          try { await rollback(changes, roots) } catch (failure) { retainBackups = true; throw failure }
          // Active states must converge to the restored on-disk files, even after a publication failure.
          await publish(env, instance, folders).catch(() => {})
          throw error
        }
        env.state('ellan.manifests.committed', () => new Map<string, CommittedFiles>()).set(instance.path, structuredClone(data))
      })
      env.task?.setProgress({ stage: 'done', current: files.length, total: files.length, value: 1 })
    } finally {
      if (!retainBackups) {
        try {
          for (const temp of globalTemps) { await safeTarget(temp.root, temp.path); await unlink(join(temp.root, ...temp.path.split('/'))).catch(e => { if (e.code !== 'ENOENT') throw e }) }
          // Only this operation's UUID directory may be removed. Never clean a computed/user path.
          inside(instance.path, staging); await directory(dirname(staging)); const current = await lstat(staging)
          if (current.isSymbolicLink() || current.ino !== stageBefore.ino || current.dev !== stageBefore.dev || basename(staging) !== stageName) fail('Transaction staging directory changed; refusing cleanup', 'UNSAFE_PATH')
          await rm(staging, { recursive: true, force: false })
        } catch {
          // Cleanup failure must not turn a successful commit into a false installation failure.
          env.context.logger('ellan-manifests').warn('Transaction staging cleanup deferred: %s', staging)
        }
      } else env.context.logger('ellan-manifests').warn('Rollback needs manual recovery; backups retained: %s', changes.filter(change => change.backed).map(change => change.backup).join(', '))
    }
  })
}
