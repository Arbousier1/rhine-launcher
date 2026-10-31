/**
 * Minimal ZIP reader built on node:zlib.
 *
 * Mod jars, resource packs and shader packs only need two operations: list the
 * central directory and inflate a single entry. Implementing that here avoids
 * a third-party dependency and keeps extraction cancellable.
 *
 * References: PKWARE APPNOTE 4.3.6 (end of central directory, central directory
 * file header, local file header).
 */
import { open, type FileHandle } from 'node:fs/promises'
import { inflateRaw } from 'node:zlib'
import { promisify } from 'node:util'

const inflate = promisify(inflateRaw)

/** Signature of the end-of-central-directory record. */
export const EOCD_SIGNATURE = 0x06054b50
/** Signature of a central directory file header. */
export const CENTRAL_SIGNATURE = 0x02014b50
/** Signature of a local file header. */
export const LOCAL_SIGNATURE = 0x04034b50

/** One entry of the central directory. */
export interface ZipEntry {
  /** Full name inside the archive, always POSIX separators with no leading slash. */
  name: string
  /** 0 = stored, 8 = deflate. */
  method: number
  compressedSize: number
  uncompressedSize: number
  crc32: number
  /** Byte offset of the local file header. */
  localHeaderOffset: number
  isDirectory: boolean
}

/** Raised when a file is not a readable ZIP archive. */
export class ZipError extends Error {
  constructor(message: string, readonly file?: string) {
    super(message)
    this.name = 'ZipError'
  }
}

/**
 * Locate the end-of-central-directory record.
 *
 * The record is at least 22 bytes and may be followed by a comment of up to
 * 64 KiB, so scan backwards through that window.
 */
export function findEndOfCentralDirectory(buffer: Uint8Array): number {
  const max = Math.min(buffer.length, 22 + 0xffff)
  for (let offset = buffer.length - 22; offset >= buffer.length - max; offset--) {
    if (offset < 0) break
    if (readU32(buffer, offset) === EOCD_SIGNATURE) return offset
  }
  return -1
}

/** Parse the central directory of an in-memory archive. */
export function readZipEntries(buffer: Uint8Array): ZipEntry[] {
  if (buffer.length < 22) throw new ZipError('文件太小，不是有效的 ZIP 压缩包')
  const eocd = findEndOfCentralDirectory(buffer)
  if (eocd < 0) throw new ZipError('找不到 ZIP 结尾目录，文件可能已损坏')
  const total = readU16(buffer, eocd + 10)
  const directorySize = readU32(buffer, eocd + 12)
  const directoryOffset = readU32(buffer, eocd + 16)
  if (directoryOffset + directorySize > buffer.length) {
    throw new ZipError('ZIP 中央目录超出文件范围')
  }

  const entries: ZipEntry[] = []
  let cursor = directoryOffset
  for (let index = 0; index < total; index++) {
    if (cursor + 46 > buffer.length) break
    if (readU32(buffer, cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipError('ZIP 中央目录签名不正确')
    }
    const method = readU16(buffer, cursor + 10)
    const crc32 = readU32(buffer, cursor + 16)
    const compressedSize = readU32(buffer, cursor + 20)
    const uncompressedSize = readU32(buffer, cursor + 24)
    const nameLength = readU16(buffer, cursor + 28)
    const extraLength = readU16(buffer, cursor + 30)
    const commentLength = readU16(buffer, cursor + 32)
    const localHeaderOffset = readU32(buffer, cursor + 42)
    const name = normalizeEntryName(
      new TextDecoder('utf-8').decode(buffer.subarray(cursor + 46, cursor + 46 + nameLength)),
    )
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      crc32,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

/** Normalise separators and strip a leading slash (zip slip protection). */
export function normalizeEntryName(raw: string): string {
  return raw.replace(/\\/g, '/').replace(/^\/+/, '')
}

/** Read and decompress a single entry. */
export async function readZipEntry(buffer: Uint8Array, entry: ZipEntry): Promise<Uint8Array> {
  if (entry.isDirectory) return new Uint8Array(0)
  const header = entry.localHeaderOffset
  if (header + 30 > buffer.length || readU32(buffer, header) !== LOCAL_SIGNATURE) {
    throw new ZipError('ZIP 本地文件头损坏: ' + entry.name)
  }
  const nameLength = readU16(buffer, header + 26)
  const extraLength = readU16(buffer, header + 28)
  const start = header + 30 + nameLength + extraLength
  const end = start + entry.compressedSize
  if (end > buffer.length) throw new ZipError('ZIP 条目超出文件范围: ' + entry.name)
  const data = buffer.subarray(start, end)
  if (entry.method === 0) return new Uint8Array(data)
  if (entry.method === 8) {
    const inflated = await inflate(Buffer.from(data))
    return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength)
  }
  throw new ZipError('不支持的 ZIP 压缩方式: ' + entry.method)
}

/** A ZIP archive opened from disk. */
export class ZipArchive {
  private constructor(
    readonly file: string,
    private handle: FileHandle,
    readonly entries: ZipEntry[],
    private readonly directory: Uint8Array,
  ) {}

  /** Open an archive and parse its central directory. */
  static async open(file: string): Promise<ZipArchive> {
    const handle = await open(file, 'r')
    try {
      const { size } = await handle.stat()
      if (size < 22) throw new ZipError('文件太小，不是有效的 ZIP 压缩包', file)
      const tail = new Uint8Array(Math.min(size, 22 + 0xffff))
      await handle.read(tail, 0, tail.length, size - tail.length)
      const eocd = findEndOfCentralDirectory(tail)
      if (eocd < 0) throw new ZipError('找不到 ZIP 结尾目录，文件可能已损坏', file)
      const total = readU16(tail, eocd + 10)
      const directorySize = readU32(tail, eocd + 12)
      const directoryOffset = readU32(tail, eocd + 16)
      const directory = new Uint8Array(directorySize)
      await handle.read(directory, 0, directorySize, directoryOffset)
      const entries = parseCentralDirectory(directory, total)
      return new ZipArchive(file, handle, entries, directory)
    } catch (error) {
      await handle.close()
      throw error
    }
  }

  /** Find an entry by exact name, ignoring case. */
  entry(name: string): ZipEntry | undefined {
    const wanted = normalizeEntryName(name).toLowerCase()
    return this.entries.find((entry) => entry.name.toLowerCase() === wanted)
  }

  /** Read one entry by name; returns undefined when it does not exist. */
  async read(name: string): Promise<Uint8Array | undefined> {
    const entry = this.entry(name)
    if (!entry) return undefined
    const compressed = new Uint8Array(entry.compressedSize)
    const offset = entry.localHeaderOffset
    const header = new Uint8Array(30)
    await this.handle.read(header, 0, 30, offset)
    if (readU32(header, 0) !== LOCAL_SIGNATURE) {
      throw new ZipError('ZIP 本地文件头损坏: ' + entry.name, this.file)
    }
    const start = offset + 30 + readU16(header, 26) + readU16(header, 28)
    await this.handle.read(compressed, 0, entry.compressedSize, start)
    if (entry.method === 0) return compressed
    if (entry.method !== 8) throw new ZipError('不支持的 ZIP 压缩方式: ' + entry.method, this.file)
    const inflated = await inflate(Buffer.from(compressed))
    return new Uint8Array(inflated.buffer, inflated.byteOffset, inflated.byteLength)
  }

  /** Read an entry as UTF-8 text. */
  async readText(name: string): Promise<string | undefined> {
    const data = await this.read(name)
    return data ? new TextDecoder('utf-8').decode(data) : undefined
  }

  async close(): Promise<void> {
    await this.handle.close()
  }
}

/** Parse a central directory buffer into entries. */
export function parseCentralDirectory(directory: Uint8Array, total: number): ZipEntry[] {
  const entries: ZipEntry[] = []
  let cursor = 0
  for (let index = 0; index < total; index++) {
    if (cursor + 46 > directory.length) break
    if (readU32(directory, cursor) !== CENTRAL_SIGNATURE) {
      throw new ZipError('ZIP 中央目录签名不正确')
    }
    const method = readU16(directory, cursor + 10)
    const crc32 = readU32(directory, cursor + 16)
    const compressedSize = readU32(directory, cursor + 20)
    const uncompressedSize = readU32(directory, cursor + 24)
    const nameLength = readU16(directory, cursor + 28)
    const extraLength = readU16(directory, cursor + 30)
    const commentLength = readU16(directory, cursor + 32)
    const localHeaderOffset = readU32(directory, cursor + 42)
    const name = normalizeEntryName(
      new TextDecoder('utf-8').decode(directory.subarray(cursor + 46, cursor + 46 + nameLength)),
    )
    entries.push({
      name,
      method,
      compressedSize,
      uncompressedSize,
      crc32,
      localHeaderOffset,
      isDirectory: name.endsWith('/'),
    })
    cursor += 46 + nameLength + extraLength + commentLength
  }
  return entries
}

function readU16(buffer: Uint8Array, offset: number): number {
  return buffer[offset] | (buffer[offset + 1] << 8)
}

function readU32(buffer: Uint8Array, offset: number): number {
  return (buffer[offset] | (buffer[offset + 1] << 8) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 24)) >>> 0
}
