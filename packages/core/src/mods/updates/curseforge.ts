import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import type { Settings } from '../../types.ts'
import { apiBase, curseFile, jsonRequest } from '../../modpack/network.ts'
import { check, fail, hashes, object, openRegular, size, text } from '../../modpack/safety.ts'
import { modName, stripDisabled } from '../../services/mods.ts'
import { resolveCurseforgeApiKey } from '../../config/secrets.ts'
import { date, errorResult, issue, localMods, result, type UpdateResult } from './common.ts'

const LOADER_IDS: Record<string, number> = { forge: 1, fabric: 4, quilt: 5, neoforge: 6 }
const whitespace = (value: number) => value === 9 || value === 10 || value === 13 || value === 32
/** CurseForge's MurmurHash2 fingerprint over bytes excluding ASCII whitespace. */
export async function curseFingerprint(path: string, env: FeatureEnvironment): Promise<number> {
  const handle = await openRegular(path)
  try {
    const initial = await handle.stat()
    size(initial.size, '模组')
    const buffer = Buffer.alloc(128 * 1024)
    let length = 0, position = 0
    while (true) {
      check(env)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (!bytesRead) break
      position += bytesRead
      for (const byte of buffer.subarray(0, bytesRead)) if (!whitespace(byte)) length++
    }
    const m = 0x5bd1e995
    let hash = (1 ^ length) >>> 0, block = 0, used = 0
    position = 0
    while (true) {
      check(env)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (!bytesRead) break
      position += bytesRead
      for (const byte of buffer.subarray(0, bytesRead)) {
        if (whitespace(byte)) continue
        block |= byte << (used * 8)
        if (++used === 4) {
          let k = Math.imul(block, m)
          k ^= k >>> 24
          k = Math.imul(k, m)
          hash = (Math.imul(hash, m) ^ k) >>> 0
          used = 0; block = 0
        }
      }
    }
    if (used) hash = Math.imul(hash ^ block, m) >>> 0
    hash ^= hash >>> 13
    hash = Math.imul(hash, m) >>> 0
    hash ^= hash >>> 15
    const after = await handle.stat()
    if (initial.size !== after.size || initial.mtimeMs !== after.mtimeMs || initial.ctimeMs !== after.ctimeMs) fail('模组在计算指纹时发生变化', 'FILE_CHANGED', 409)
    check(env)
    return hash >>> 0
  } finally { await handle.close() }
}
function currentHashes(value: unknown) {
  if (!Array.isArray(value)) fail('CurseForge 文件缺少 hashes', 'INVALID_RESPONSE', 502)
  const entries = value.map(item => object(item, 'CurseForge hash'))
  return hashes(Object.fromEntries(entries.filter(item => item.algo === 1 || item.algo === 2).map(item => [item.algo === 1 ? 'sha1' : 'md5', item.value])))
}
export async function checkCurseForge(instanceId: string, env: FeatureEnvironment): Promise<UpdateResult[]> {
  const { instance, mods, results } = await localMods(instanceId, 'curseforge', env)
  if (!mods.length) return results
  const settings = await env.use<Settings>('settings.resolve')
  const key = resolveCurseforgeApiKey(settings.curseforgeApiKey).value
  if (!key) return [...results, ...mods.map(local => errorResult(local.mod, 'curseforge', new FeatureError('CURSEFORGE_API_KEY_REQUIRED', '检查 CurseForge 更新需要配置 API key（环境变量 RHINE_CURSEFORGE_API_KEY 或设置页）', 503)))]
  const base = apiBase(settings.mirrors.curseforge, 'curseforge')
  const fingerprints = new Map<string, number>()
  const ready = [] as typeof mods
  for (const local of mods) {
    try { fingerprints.set(local.path, await curseFingerprint(local.path, env)); ready.push(local) }
    catch (error) { check(env); results.push(errorResult(local.mod, 'curseforge', error)) }
  }
  let exact: any[]
  try {
    const response = object(await jsonRequest(base + '/fingerprints/432', env, { method: 'POST', headers: { 'x-api-key': key, 'content-type': 'application/json' }, body: JSON.stringify({ fingerprints: ready.map(local => fingerprints.get(local.path)) }) }), 'CurseForge 指纹响应')
    const data = object(response.data, 'CurseForge 指纹数据')
    if (!Array.isArray(data.exactMatches)) fail('CurseForge 指纹匹配响应无效', 'INVALID_RESPONSE', 502)
    exact = data.exactMatches
  } catch (error) { check(env); return [...results, ...ready.map(local => errorResult(local.mod, 'curseforge', error))] }
  for (const local of ready) {
    check(env)
    env.task?.setProgress({ stage: 'resolve', message: '检查 CurseForge 更新 ' + local.mod.diskName })
    try {
      const matches = exact.filter(match => match?.file?.fileFingerprint === fingerprints.get(local.path))
      const match = matches.find(match => {
        const expected = currentHashes(match.file.hashes)
        return Object.entries(expected).every(([algorithm, hash]) => local.snapshot.hashes[algorithm as keyof typeof expected] === hash)
      })
      if (!match) { results.push(errorResult(local.mod, 'curseforge', new FeatureError('MOD_NOT_IDENTIFIED', 'CurseForge 未识别此文件', 404), 'unknown')); continue }
      const current = object(match.file, 'CurseForge 当前文件')
      const projectId = current.modId
      if (!Number.isSafeInteger(projectId) || projectId <= 0 || match.id !== projectId || !Number.isSafeInteger(current.id) || size(current.fileLength, 'CurseForge 当前文件') !== local.snapshot.size) fail('CurseForge 指纹匹配的文件无效', 'INVALID_RESPONSE', 502)
      const currentDate = date(current.fileDate)
      const loader = instance.loaders.find(loader => loader.kind !== 'vanilla')?.kind
      if (loader && !LOADER_IDS[loader]) fail('CurseForge 不支持此加载器', 'INVALID_RESPONSE', 502)
      const files: Record<string, any>[] = []
      for (let index = 0; ; ) {
        const query = new URLSearchParams({ gameVersion: instance.gameVersion, index: String(index), pageSize: '50' })
        if (loader) query.set('modLoaderType', String(LOADER_IDS[loader]))
        const page = object(await jsonRequest(base + '/mods/' + projectId + '/files?' + query, env, { headers: { 'x-api-key': key } }), 'CurseForge 版本响应')
        if (!Array.isArray(page.data)) fail('CurseForge 版本列表无效', 'INVALID_RESPONSE', 502)
        for (const entry of page.data) files.push(object(entry, 'CurseForge 版本'))
        const total = page.pagination?.totalCount
        if (total === undefined) { if (page.data.length >= 50) fail('CurseForge 分页信息缺失', 'INVALID_RESPONSE', 502); break }
        if (!Number.isSafeInteger(total) || total < 0 || total > 1000 || !page.data.length && index < total) fail('CurseForge 分页超出限制或无效', 'INVALID_RESPONSE', 502)
        index += page.data.length
        if (index >= total) break
      }
      const compatible = files.filter(file => {
        if (file.modId !== projectId || !Array.isArray(file.gameVersions)) fail('CurseForge 版本兼容性数据无效', 'INVALID_RESPONSE', 502)
        date(file.fileDate)
        return file.gameVersions.includes(instance.gameVersion) && (!loader || file.gameVersions.some((value: unknown) => typeof value === 'string' && value.toLowerCase() === loader))
      }).sort((a, b) => date(b.fileDate) - date(a.fileDate))
      const latest = compatible.find(file => file.id !== current.id && date(file.fileDate) > currentDate)
      if (!latest) { results.push(result(local.mod, 'curseforge', 'current')); continue }
      const project = object(object(await jsonRequest(base + '/mods/' + projectId, env, { headers: { 'x-api-key': key } }), 'CurseForge 项目响应').data, 'CurseForge 项目')
      if (project.id !== projectId || project.gameId !== 432 || project.classId !== 6) fail('CurseForge 返回了错误的模组项目', 'INVALID_RESPONSE', 502)
      if (project.allowModDistribution === false) fail('作者禁止第三方下载，请手动下载该模组', 'CURSEFORGE_MANUAL_DOWNLOAD', 409)
      const file = curseFile(latest, projectId, latest.id)
      const name = modName(file.fileName)
      if (name !== stripDisabled(name)) fail('更新文件名无效', 'INVALID_RESPONSE', 502)
      results.push(issue(env, instanceId, local, 'curseforge', { url: file.url, fileName: name, hashes: file.hashes, size: file.size! }, text(latest.displayName ?? latest.fileName, '版本名称'), String(latest.id)))
    } catch (error) { check(env); results.push(errorResult(local.mod, 'curseforge', error)) }
  }
  check(env)
  return results
}
