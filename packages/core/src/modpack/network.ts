import { FeatureError } from '@rhine/plugin-api'
import { open, rename, rm } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { dirname, join } from 'node:path'
import { check, fail, fileName, hashes, httpUrl, MAX_FILE_BYTES, object, size, targetPath, type Hashes, type Operation } from './safety.ts'

const AGENT = 'RhineLauncher/0.1.0 (rhine-launcher)'
export interface DownloadFile { path: string; url: string; mirrors?: string[]; hashes: Hashes; size?: number }
export function apiBase(raw: string | undefined, provider: 'modrinth' | 'curseforge'): string {
  const suffix = provider === 'modrinth' ? '/v2' : '/v1'
  const base = httpUrl(raw || (provider === 'modrinth' ? 'https://api.modrinth.com' : 'https://api.curseforge.com')).replace(/\/+$/, '')
  return base.endsWith(suffix) ? base : base + suffix
}
export async function jsonRequest(url: string, op: Operation, init: RequestInit = {}): Promise<unknown> {
  check(op)
  let response: Response
  const signal = AbortSignal.any([op.signal, AbortSignal.timeout(30000)])
  try { response = await fetch(httpUrl(url), { ...init, headers: { 'user-agent': AGENT, ...init.headers }, signal, redirect: 'error' }) }
  catch (error) { check(op); throw new FeatureError('PROVIDER_UNAVAILABLE', '无法连接远端 API：' + (error as Error).message, 502) }
  if (!response.ok) { await response.body?.cancel(); throw new FeatureError('PROVIDER_HTTP_ERROR', '远端 API 返回 HTTP ' + response.status, 502) }
  const reader = response.body?.getReader()
  if (!reader) fail('远端 API 返回空响应', 'INVALID_RESPONSE', 502)
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    while (true) {
      check(op)
      const { value, done } = await reader.read()
      if (done) break
      total += value.length
      if (total > 8 * 1024 * 1024) fail('远端 JSON 超过大小限制', 'INVALID_RESPONSE', 502)
      chunks.push(value)
    }
  } catch (error) { await reader.cancel().catch(() => {}); check(op); throw error }
  finally { reader.releaseLock() }
  check(op)
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))) }
  catch { return fail('远端 API 返回的 JSON 无效', 'INVALID_RESPONSE', 502) }
}

/** Stream to an exclusive sibling temporary file; publish only after all hashes match. */
export async function downloadVerified(root: string, file: DownloadFile, op: Operation): Promise<number> {
  check(op)
  const expected = hashes(file.hashes, false)
  if (file.size !== undefined) size(file.size, '下载文件')
  const destination = await targetPath(root, file.path, true)
  const urls = [file.url, ...(file.mirrors ?? [])].map(httpUrl)
  const failures: string[] = []
  for (const url of urls) {
    check(op)
    const partial = join(dirname(destination), '.rhine-download-' + randomUUID() + '.part')
    let handle: Awaited<ReturnType<typeof open>> | undefined
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
    try {
      const response = await fetch(url, { headers: { 'user-agent': AGENT }, signal: AbortSignal.any([op.signal, AbortSignal.timeout(120000)]) })
      if (!response.ok) { await response.body?.cancel(); throw new Error('HTTP ' + response.status) }
      reader = response.body?.getReader()
      if (!reader) throw new Error('下载响应为空')
      handle = await open(partial, 'wx', 0o600)
      const digests = Object.entries(expected).map(([algorithm, hash]) => ({ algorithm, hash, digest: createHash(algorithm) }))
      let received = 0
      while (true) {
        check(op)
        const { value, done } = await reader.read()
        if (done) break
        received += value.length
        if (received > (file.size ?? MAX_FILE_BYTES)) throw new Error('下载超过声明大小或安全限制')
        await handle.writeFile(value)
        for (const item of digests) item.digest.update(value)
        op.task?.setProgress({ stage: 'download', current: received, total: file.size, message: '下载 ' + file.path })
      }
      check(op)
      op.task?.setProgress({ stage: 'verify', message: '校验 ' + file.path })
      if (file.size !== undefined && received !== file.size) throw new Error('文件大小校验失败')
      for (const item of digests) if (item.digest.digest('hex') !== item.hash) throw new Error(item.algorithm + ' 哈希校验失败')
      await handle.sync()
      await handle.close(); handle = undefined
      check(op)
      await targetPath(root, file.path)
      await rename(partial, destination)
      return received
    } catch (error) {
      if (reader) await reader.cancel().catch(() => {})
      if (handle) await handle.close()
      await rm(partial, { force: true })
      check(op)
      failures.push((error as Error).message)
      op.task?.log('下载失败 ' + file.path + '：' + (error as Error).message, 'warn')
    } finally { reader?.releaseLock() }
  }
  throw new FeatureError('DOWNLOAD_FAILED', '下载或校验失败 ' + file.path + '：' + failures.join('；'), 502)
}

export function curseFile(payload: unknown, projectID: number, fileID: number): DownloadFile & { fileName: string; data: Record<string, any> } {
  const data = object(payload, 'CurseForge 文件')
  if (data.id !== fileID || data.modId !== projectID) fail('CurseForge 返回了错误的项目/文件 ID', 'INVALID_RESPONSE', 502)
  if (data.isAvailable === false || typeof data.downloadUrl !== 'string' || !data.downloadUrl) fail('CurseForge 文件不可自动下载；作者可能禁止第三方下载，请通过作者提供的页面手动下载 (project ' + projectID + ', file ' + fileID + ')', 'CURSEFORGE_MANUAL_DOWNLOAD', 409)
  const name = fileName(data.fileName)
  if (!Array.isArray(data.hashes)) fail('CurseForge 文件缺少校验值', 'INVALID_RESPONSE', 502)
  const values: Hashes = {}
  for (const item of data.hashes) {
    const hash = object(item, 'CurseForge hash')
    const algorithm = hash.algo === 1 ? 'sha1' : hash.algo === 2 ? 'md5' : undefined
    if (algorithm) {
      if (values[algorithm] !== undefined && values[algorithm] !== hash.value) fail('CurseForge 哈希值冲突', 'INVALID_RESPONSE', 502)
      values[algorithm] = hash.value
    }
  }
  const verifiedHashes = hashes(values)
  return { path: 'mods/' + name, fileName: name, url: httpUrl(data.downloadUrl), hashes: verifiedHashes, size: size(data.fileLength, 'CurseForge 文件'), data }
}
