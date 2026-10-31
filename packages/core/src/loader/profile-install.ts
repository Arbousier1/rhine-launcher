/**
 * Shared installer for profile-based loaders (Fabric, Quilt).
 *
 * The loader writes the profile json atomically and validates that the base
 * capability now reports the version as installed; a failed verification rolls
 * the new directory back instead of leaving a half-installed profile.
 */
import type { RawVersionJson } from '../contracts.ts'
import type { LoaderHost } from './capabilities.ts'
import { reportProgress } from './capabilities.ts'
import { errorMessage, fetchText } from './http.ts'
import { removeVersionDir, versionJsonExists, writeVersionJson } from './versions.ts'

/** One profile-based install action. */
export interface ProfileInstallSpec {
  /** Canonical version id (also used in progress messages). */
  id: string
  /** Human label, e.g. Fabric. */
  label: string
  /** Candidate HTTPS profile URLs. */
  profileUrls: string[]
  /** Normalise/validate the upstream profile into a version json. */
  normalize: (payload: unknown) => RawVersionJson
}

/**
 * Download a profile json and install it into versions/.
 *
 * @returns the installed version id.
 */
export async function installProfileVersion(host: LoaderHost, spec: ProfileInstallSpec): Promise<string> {
  reportProgress(host, { stage: 'resolve', value: 0.02, current: 0, total: 1, message: '获取 ' + spec.label + ' 安装配置' })
  const response = await fetchText(host, spec.profileUrls, spec.label + ' 安装配置', { signal: host.signal })
  let payload: unknown
  try {
    payload = JSON.parse(response.text)
  } catch {
    throw new Error(spec.label + ' 安装配置不是合法的 JSON')
  }
  const json = spec.normalize(payload)
  const id = typeof json.id === 'string' ? json.id : spec.id
  if (typeof json.mainClass !== 'string' || !json.mainClass) {
    throw new Error(spec.label + ' 安装配置缺少 mainClass')
  }
  if (!json.inheritsFrom) {
    throw new Error(spec.label + ' 安装配置缺少 inheritsFrom')
  }

  const versionsRoot = host.paths().versions
  const existed = await versionJsonExists(versionsRoot, id)
  reportProgress(host, { stage: 'write', value: 0.8, current: 0, total: 1, message: '写入版本文件 ' + id })
  try {
    await writeVersionJson(versionsRoot, json)
    const installed = await host.installedVersions()
    if (!installed.includes(id)) {
      throw new Error('写入后未在已安装版本列表中找到 ' + id)
    }
  } catch (error) {
    if (!existed) await removeVersionDir(versionsRoot, id).catch(() => undefined)
    throw new Error(spec.label + ' 安装失败：' + errorMessage(error))
  }

  reportProgress(host, { stage: 'done', value: 1, current: 1, total: 1, message: spec.label + ' 安装完成' })
  host.log('已安装 ' + spec.label + ' ' + id)
  return id
}
