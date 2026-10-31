/**
 * Installer archive access.
 *
 * Forge/NeoForge installer jars and OptiFine patcher jars are ordinary ZIP
 * archives. The loader only trusts a jar after the ZIP signature and central
 * directory both parse, never because a download reported a positive size.
 */
import { open, readFile } from 'node:fs/promises'
import { ZipArchive } from '../mods/zip.ts'

/** ZIP local-file-header signature. */
export const ZIP_LOCAL_MAGIC = [0x50, 0x4b, 0x03, 0x04] as const

/** ZIP end-of-central-directory signature (empty archives). */
export const ZIP_EOCD_MAGIC = [0x50, 0x4b, 0x05, 0x06] as const

/** Raised when a downloaded jar is not a usable archive. */
export class LoaderArchiveError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'LoaderArchiveError'
  }
}

/** Cheap signature check that does not parse the whole archive. */
export async function hasZipSignature(path: string): Promise<boolean> {
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(path, 'r')
    const header = new Uint8Array(4)
    const { bytesRead } = await handle.read(header, 0, 4, 0)
    if (bytesRead < 4) return false
    return header[0] === 0x50 && header[1] === 0x4b
  } catch {
    return false
  } finally {
    await handle?.close().catch(() => undefined)
  }
}

/**
 * Open an archive after validating the ZIP signature and central directory.
 *
 * @throws LoaderArchiveError when the file is missing, too small, or corrupt.
 */
export async function openLoaderArchive(path: string): Promise<ZipArchive> {
  if (!(await hasZipSignature(path))) {
    throw new LoaderArchiveError('文件不是有效的 ZIP/JAR 压缩包：' + path)
  }
  try {
    const archive = await ZipArchive.open(path)
    if (archive.entries.length === 0) {
      await archive.close()
      throw new LoaderArchiveError('ZIP 压缩包为空：' + path)
    }
    return archive
  } catch (error) {
    if (error instanceof LoaderArchiveError) throw error
    throw new LoaderArchiveError('无法读取 ZIP 压缩包：' + path + '（' + messageOf(error) + '）')
  }
}

/** True when the file parses as a non-empty ZIP archive. */
export async function isZipArchive(path: string): Promise<boolean> {
  try {
    const archive = await openLoaderArchive(path)
    await archive.close()
    return true
  } catch {
    return false
  }
}

/** Read one entry from an archive without keeping it open. */
export async function readArchiveEntry(path: string, entry: string): Promise<Uint8Array | undefined> {
  const archive = await openLoaderArchive(path)
  try {
    return await archive.read(entry)
  } finally {
    await archive.close().catch(() => undefined)
  }
}

/** Read one UTF-8 entry from an archive. */
export async function readArchiveText(path: string, entry: string): Promise<string | undefined> {
  const data = await readArchiveEntry(path, entry)
  return data ? new TextDecoder('utf-8').decode(data) : undefined
}

/** Parse a JSON entry; throws a Chinese error naming the archive. */
export async function readArchiveJson<T>(path: string, entry: string): Promise<T | undefined> {
  const text = await readArchiveText(path, entry)
  if (text === undefined) return undefined
  try {
    return JSON.parse(text) as T
  } catch {
    throw new LoaderArchiveError('无法解析 ' + entry + '：' + path)
  }
}

/** List archive entry names. */
export async function listArchiveEntries(path: string): Promise<string[]> {
  const archive = await openLoaderArchive(path)
  try {
    return archive.entries.map((item) => item.name)
  } finally {
    await archive.close().catch(() => undefined)
  }
}

/** First 8 bytes as hex, used in diagnostics. */
export async function fileHeaderHex(path: string): Promise<string> {
  const data = await readFile(path)
  return Buffer.from(data.subarray(0, 8)).toString('hex')
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
