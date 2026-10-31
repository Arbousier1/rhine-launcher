/**
 * HTTPS-only resource access with mirror fallback.
 *
 * A loader install may fetch dozens of small artefacts. Every candidate URL is
 * HTTPS (a plain-HTTP mirror is never used as a downgrade), every download is
 * checked against the publisher hash when one is known, and archives must parse
 * as ZIP before a caller may execute them.
 */
import { createHash } from 'node:crypto'
import { readFile, rm, stat } from 'node:fs/promises'
import type { DownloadOptions } from '../contracts.ts'
import { isZipArchive } from './archive.ts'

/** Raised when no candidate could provide a resource. */
export class LoaderHttpError extends Error {
  constructor(message: string, readonly urls: readonly string[] = []) {
    super(message)
    this.name = 'LoaderHttpError'
  }
}

/** Minimal host surface used by this module (matches LoaderHost). */
export interface TextFetcher {
  text(url: string): Promise<string>
}

/** Minimal host surface used by this module (matches LoaderHost). */
export interface FileFetcher {
  file(options: DownloadOptions): Promise<number>
}

/** True for an absolute https URL. */
export function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

/**
 * De-duplicate candidate URLs and drop every non-HTTPS entry.
 *
 * HTTP entries are removed instead of being tried after an HTTPS failure: the
 * loader must never fall back to plain text for code it will execute.
 */
export function httpsCandidates(candidates: readonly (string | undefined | null)[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const candidate of candidates) {
    const url = (candidate ?? '').trim()
    if (!url || seen.has(url) || !isHttpsUrl(url)) continue
    seen.add(url)
    out.push(url)
  }
  return out
}

/** Require at least one HTTPS candidate. */
export function requireHttpsCandidates(candidates: readonly (string | undefined | null)[], label: string): string[] {
  const urls = httpsCandidates(candidates)
  if (urls.length === 0) {
    throw new LoaderHttpError('没有可用的 HTTPS 下载地址：' + label)
  }
  return urls
}

/** Fetch the first candidate that returns text. */
export async function fetchText(
  fetcher: TextFetcher,
  urls: readonly (string | undefined | null)[],
  label: string,
  options: { signal?: AbortSignal } = {},
): Promise<{ text: string; url: string }> {
  const candidates = requireHttpsCandidates(urls, label)
  const errors: string[] = []
  for (const url of candidates) {
    throwIfAborted(options.signal)
    try {
      const text = await fetcher.text(url)
      return { text, url }
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }
  throw new LoaderHttpError('无法获取 ' + label + '：' + lastError(errors), candidates)
}

/** Options for {@link downloadVerified}. */
export interface DownloadVerifiedOptions {
  urls: readonly (string | undefined | null)[]
  destination: string
  label: string
  sha1?: string
  sha256?: string
  size?: number
  /** Validate the file as a ZIP archive after downloading. */
  expectArchive?: boolean
  signal?: AbortSignal
  /** Retries passed to the host downloader for each candidate URL. */
  retries?: number
}

/** Result of a verified download. */
export interface DownloadedFile {
  path: string
  bytes: number
  sha1: string
  sha256: string
  source: string
}

/**
 * Download a file from the first candidate that satisfies every check.
 *
 * A candidate is accepted only when the optional publisher hash/size matches
 * and, for archives, the ZIP central directory parses. A file left behind by a
 * failed candidate is deleted before the next one is tried.
 */
export async function downloadVerified(
  fetcher: FileFetcher,
  options: DownloadVerifiedOptions,
): Promise<DownloadedFile> {
  const candidates = requireHttpsCandidates(options.urls, options.label)
  const existing = await verifyExisting(options)
  if (existing) return existing

  const errors: string[] = []
  for (const url of candidates) {
    throwIfAborted(options.signal)
    try {
      await fetcher.file({
        url,
        destination: options.destination,
        sha1: options.sha1,
        size: options.size,
        skipIfExists: true,
        retries: options.retries ?? 2,
      })
      const checked = await verifyDownloaded(options, url)
      if (checked) return checked
      errors.push('校验失败：' + url)
      await rm(options.destination, { force: true }).catch(() => undefined)
    } catch (error) {
      errors.push(errorMessage(error))
    }
  }
  throw new LoaderHttpError('无法下载 ' + options.label + '：' + lastError(errors), candidates)
}

/** Fetch a checksum sidecar ('.sha1'/'.sha256') from the first available mirror. */
export async function fetchChecksums(
  fetcher: TextFetcher,
  urls: readonly (string | undefined | null)[],
  options: { signal?: AbortSignal } = {},
): Promise<{ sha1?: string; sha256?: string }> {
  const candidates = httpsCandidates(urls)
  const result: { sha1?: string; sha256?: string } = {}
  for (const base of candidates) {
    throwIfAborted(options.signal)
    if (!result.sha1) {
      const value = await readSidecar(fetcher, base + '.sha1', 40, options.signal)
      if (value) result.sha1 = value
    }
    if (!result.sha256) {
      const value = await readSidecar(fetcher, base + '.sha256', 64, options.signal)
      if (value) result.sha256 = value
    }
    if (result.sha1 && result.sha256) break
  }
  return result
}

/** Hash one file. */
export async function hashFile(path: string, algorithm: 'sha1' | 'sha256'): Promise<string> {
  const data = await readFile(path)
  return createHash(algorithm).update(data).digest('hex')
}

/** File size or undefined when it does not exist. */
export async function fileSize(path: string): Promise<number | undefined> {
  try {
    return (await stat(path)).size
  } catch {
    return undefined
  }
}

async function readSidecar(
  fetcher: TextFetcher,
  url: string,
  length: number,
  signal?: AbortSignal,
): Promise<string | undefined> {
  if (!isHttpsUrl(url)) return undefined
  try {
    throwIfAborted(signal)
    const text = await fetcher.text(url)
    const match = /[0-9a-fA-F]/.test(text) ? /([0-9a-fA-F]+)/.exec(text.trim()) : null
    const value = match?.[1]?.toLowerCase()
    return value && value.length === length ? value : undefined
  } catch {
    return undefined
  }
}

async function verifyExisting(options: DownloadVerifiedOptions): Promise<DownloadedFile | undefined> {
  const bytes = await fileSize(options.destination)
  if (bytes === undefined || bytes === 0) return undefined
  if (options.size !== undefined && bytes !== options.size) return undefined
  const sha1 = await hashFile(options.destination, 'sha1').catch(() => undefined)
  const sha256 = await hashFile(options.destination, 'sha256').catch(() => undefined)
  if (!sha1 || !sha256) return undefined
  if (options.sha1 && sha1 !== options.sha1.toLowerCase()) return undefined
  if (options.sha256 && sha256 !== options.sha256.toLowerCase()) return undefined
  if (options.expectArchive && !(await isZipArchive(options.destination))) return undefined
  if (!options.sha1 && !options.sha256 && !options.expectArchive) return undefined
  return { path: options.destination, bytes, sha1, sha256, source: 'cache' }
}

async function verifyDownloaded(
  options: DownloadVerifiedOptions,
  source: string,
): Promise<DownloadedFile | undefined> {
  const bytes = await fileSize(options.destination)
  if (bytes === undefined || bytes === 0) return undefined
  if (options.size !== undefined && bytes !== options.size) return undefined
  const sha1 = await hashFile(options.destination, 'sha1').catch(() => undefined)
  const sha256 = await hashFile(options.destination, 'sha256').catch(() => undefined)
  if (!sha1 || !sha256) return undefined
  if (options.sha1 && sha1 !== options.sha1.toLowerCase()) return undefined
  if (options.sha256 && sha256 !== options.sha256.toLowerCase()) return undefined
  if (options.expectArchive && !(await isZipArchive(options.destination))) return undefined
  return { path: options.destination, bytes, sha1, sha256, source }
}

function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  const error = new Error('操作已取消')
  error.name = 'AbortError'
  throw error
}

function lastError(errors: string[]): string {
  return errors.length > 0 ? errors[errors.length - 1] : '未知错误'
}

/** Message of an unknown error. */
export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
