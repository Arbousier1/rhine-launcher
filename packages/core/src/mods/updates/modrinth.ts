import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import type { Settings } from '../../types.ts'
import { apiBase, jsonRequest } from '../../modpack/network.ts'
import { check, fail, hashes, httpUrl, object, size, text } from '../../modpack/safety.ts'
import { modName, stripDisabled } from '../../services/mods.ts'
import { date, errorResult, issue, localMods, result, type UpdateResult } from './common.ts'

function versionData(value: unknown): Record<string, any> {
  const data = object(value, 'Modrinth 版本')
  text(data.id, '版本 ID'); text(data.project_id, '项目 ID'); text(data.version_number, '版本号')
  date(data.date_published)
  return data
}
export async function checkModrinth(instanceId: string, env: FeatureEnvironment): Promise<UpdateResult[]> {
  const { instance, mods, results } = await localMods(instanceId, 'modrinth', env)
  if (!mods.length) return results
  const settings = await env.use<Settings>('settings.resolve')
  const base = apiBase(settings.mirrors.modrinth, 'modrinth')
  let matches: Record<string, any>
  try {
    matches = object(await jsonRequest(base + '/version_files', env, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ hashes: mods.map(local => local.snapshot.hashes.sha1), algorithm: 'sha1' }) }), 'Modrinth 匹配响应')
  } catch (error) { check(env); return [...results, ...mods.map(local => errorResult(local.mod, 'modrinth', error))] }
  const projects = new Map<string, Promise<unknown>>()
  for (const local of mods) {
    check(env)
    env.task?.setProgress({ stage: 'resolve', message: '检查更新 ' + local.mod.diskName })
    try {
      const matched = matches[local.snapshot.hashes.sha1!]
      if (!matched) {
        results.push(errorResult(local.mod, 'modrinth', new FeatureError('MOD_NOT_IDENTIFIED', 'Modrinth 未识别此文件', 404), 'unknown'))
        continue
      }
      const current = versionData(matched)
      const loaders = instance.loaders.map(loader => loader.kind).filter(kind => kind !== 'vanilla')
      const query = new URLSearchParams({ game_versions: JSON.stringify([instance.gameVersion]) })
      if (loaders.length) query.set('loaders', JSON.stringify(loaders))
      const url = base + '/project/' + encodeURIComponent(current.project_id) + '/version?' + query
      if (!projects.has(url)) projects.set(url, jsonRequest(url, env))
      const response = await projects.get(url)
      if (!Array.isArray(response) || response.length > 10000) fail('Modrinth 版本列表无效', 'INVALID_RESPONSE', 502)
      const versions = response.map(versionData).filter(candidate => {
        if (candidate.project_id !== current.project_id || !Array.isArray(candidate.game_versions) || !Array.isArray(candidate.loaders)) fail('Modrinth 版本兼容性数据无效', 'INVALID_RESPONSE', 502)
        return candidate.game_versions.includes(instance.gameVersion) && (!loaders.length || loaders.some(loader => candidate.loaders.includes(loader)))
      }).sort((a, b) => date(b.date_published) - date(a.date_published))
      const latest = versions.find(candidate => candidate.id !== current.id && date(candidate.date_published) > date(current.date_published))
      if (!latest) { results.push({ ...result(local.mod, 'modrinth', 'current'), currentVersion: current.version_number }); continue }
      if (!Array.isArray(latest.files)) fail('Modrinth 更新缺少文件', 'INVALID_RESPONSE', 502)
      const primary = latest.files.filter((file: any) => file?.primary === true)
      const candidate = object(primary.length === 1 ? primary[0] : latest.files.length === 1 ? latest.files[0] : undefined, 'Modrinth 主文件')
      const name = modName(candidate.filename)
      if (name !== stripDisabled(name)) fail('远端模组文件名不能包含 .disabled', 'INVALID_RESPONSE', 502)
      const file = { fileName: name, url: httpUrl(candidate.url), hashes: hashes(candidate.hashes), size: size(candidate.size, '更新文件') }
      if (!file.hashes.sha1 && !file.hashes.sha512 && !file.hashes.sha256) fail('更新缺少安全哈希', 'INVALID_RESPONSE', 502)
      const row = issue(env, instanceId, local, 'modrinth', file, latest.version_number, latest.id)
      row.currentVersion = local.mod.meta?.version ?? current.version_number
      if (typeof latest.changelog === 'string') row.changelog = latest.changelog
      results.push(row)
    } catch (error) { check(env); results.push(errorResult(local.mod, 'modrinth', error)) }
  }
  check(env)
  return results
}
