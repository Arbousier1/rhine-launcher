import { inflateRaw, crc32 } from 'node:zlib'
import { promisify } from 'node:util'
import type { FileHandle } from 'node:fs/promises'
import { ZipArchive, findEndOfCentralDirectory, type ZipEntry } from '../mods/zip.ts'
import { check, fail, openRegular, relativePath, size, type Operation } from './safety.ts'

const inflate = promisify(inflateRaw)
export const MAX_ARCHIVE_BYTES = 1024 * 1024 * 1024
export const MAX_ENTRY_BYTES = 128 * 1024 * 1024
export const MAX_TOTAL_BYTES = 4 * 1024 * 1024 * 1024
export const MAX_ENTRIES = 20000
interface Entry extends ZipEntry { start: number }

async function readExact(handle: FileHandle, length: number, position: number): Promise<Buffer> {
  const result = Buffer.alloc(length)
  let read = 0
  while (read < length) {
    const part = await handle.read(result, read, length - read, position + read)
    if (!part.bytesRead) fail('ZIP 数据被截断', 'INVALID_ARCHIVE')
    read += part.bytesRead
  }
  return result
}

/** Strict preflight around the existing reader. Never use its unbounded inflate. */
export class PackArchive {
  private constructor(private zip: ZipArchive, private handle: FileHandle, readonly entries: Entry[], private op?: Operation) {}

  static async open(file: string, op?: Operation): Promise<PackArchive> {
    check(op)
    const handle = await openRegular(file)
    let zip: ZipArchive | undefined
    try {
      const info = await handle.stat()
      size(info.size, 'ZIP', MAX_ARCHIVE_BYTES)
      if (info.size < 22) fail('不是有效 ZIP', 'INVALID_ARCHIVE')
      const tail = await readExact(handle, Math.min(info.size, 65557), Math.max(0, info.size - 65557))
      const end = findEndOfCentralDirectory(tail)
      if (end < 0 || end + 22 + tail.readUInt16LE(end + 20) !== tail.length) fail('ZIP 结尾损坏', 'INVALID_ARCHIVE')
      const count = tail.readUInt16LE(end + 10)
      const directorySize = tail.readUInt32LE(end + 12)
      const directoryOffset = tail.readUInt32LE(end + 16)
      if (tail.readUInt16LE(end + 4) || tail.readUInt16LE(end + 6) || tail.readUInt16LE(end + 8) !== count || count === 65535 || directoryOffset === 0xffffffff || directorySize === 0xffffffff) fail('不支持分卷或 ZIP64 整合包', 'INVALID_ARCHIVE')
      if (!count || count > MAX_ENTRIES || directorySize > 16 * 1024 * 1024 || directoryOffset + directorySize !== info.size - tail.length + end) fail('ZIP 中央目录大小超出限制', 'INVALID_ARCHIVE')
      const central = await readExact(handle, directorySize, directoryOffset)
      const entries: Entry[] = []
      const seen = new Map<string, boolean>()
      let cursor = 0, total = 0
      for (let i = 0; i < count; i++) {
        check(op)
        if (cursor + 46 > central.length || central.readUInt32LE(cursor) !== 0x02014b50) fail('ZIP 中央目录损坏', 'INVALID_ARCHIVE')
        const flags = central.readUInt16LE(cursor + 8)
        const method = central.readUInt16LE(cursor + 10)
        const compressedSize = central.readUInt32LE(cursor + 20)
        const uncompressedSize = central.readUInt32LE(cursor + 24)
        const nameLength = central.readUInt16LE(cursor + 28)
        const length = 46 + nameLength + central.readUInt16LE(cursor + 30) + central.readUInt16LE(cursor + 32)
        if (cursor + length > central.length || !nameLength || flags & 0x2041 || ![0, 8].includes(method) || central.readUInt16LE(cursor + 34)) fail('ZIP 条目损坏、加密或压缩方式不支持', 'INVALID_ARCHIVE')
        const rawName = central.subarray(cursor + 46, cursor + 46 + nameLength)
        let name: string
        try { name = new TextDecoder('utf-8', { fatal: true }).decode(rawName) } catch { return fail('ZIP 文件名不是 UTF-8', 'INVALID_ARCHIVE') }
        const isDirectory = name.endsWith('/')
        const clean = relativePath(name, isDirectory)
        const key = clean.normalize('NFC').toLowerCase()
        if (seen.has(key)) fail('ZIP 包含重复或大小写冲突的路径：' + name, 'UNSAFE_PATH')
        seen.set(key, isDirectory)
        const unixType = (central.readUInt32LE(cursor + 38) >>> 16) & 0xf000
        if (unixType && unixType !== (isDirectory ? 0x4000 : 0x8000)) fail('ZIP 不允许符号链接或特殊文件：' + name, 'UNSAFE_PATH')
        size(compressedSize, 'ZIP 压缩条目', MAX_ENTRY_BYTES)
        size(uncompressedSize, 'ZIP 解压条目', MAX_ENTRY_BYTES)
        total += uncompressedSize
        if (total > MAX_TOTAL_BYTES || (isDirectory && uncompressedSize)) fail('ZIP 解压大小超出限制', 'INVALID_ARCHIVE')
        const offset = central.readUInt32LE(cursor + 42)
        if (offset + 30 > directoryOffset) fail('ZIP 本地条目越界', 'INVALID_ARCHIVE')
        const local = await readExact(handle, 30, offset)
        if (local.readUInt32LE(0) !== 0x04034b50 || local.readUInt16LE(6) !== flags || local.readUInt16LE(8) !== method || local.readUInt16LE(26) !== nameLength) fail('ZIP 本地条目与目录不一致', 'INVALID_ARCHIVE')
        const start = offset + 30 + nameLength + local.readUInt16LE(28)
        if (start + compressedSize > directoryOffset || !(await readExact(handle, nameLength, offset + 30)).equals(rawName)) fail('ZIP 本地路径或范围不一致', 'INVALID_ARCHIVE')
        const checksum = central.readUInt32LE(cursor + 16)
        if (!(flags & 8) && (local.readUInt32LE(14) !== checksum || local.readUInt32LE(18) !== compressedSize || local.readUInt32LE(22) !== uncompressedSize)) fail('ZIP 大小或 CRC 不一致', 'INVALID_ARCHIVE')
        entries.push({ name, method, compressedSize, uncompressedSize, crc32: checksum, localHeaderOffset: offset, isDirectory, start })
        cursor += length
      }
      if (cursor !== central.length) fail('ZIP 中央目录包含多余数据', 'INVALID_ARCHIVE')
      for (const [key] of seen) {
        const parts = key.split('/')
        for (let i = 1; i < parts.length; i++) if (seen.get(parts.slice(0, i).join('/')) === false) fail('ZIP 文件与目录路径冲突', 'UNSAFE_PATH')
      }
      const ranges = [...entries].sort((a, b) => a.localHeaderOffset - b.localHeaderOffset)
      for (let i = 1; i < ranges.length; i++) if (ranges[i].localHeaderOffset < ranges[i - 1].start + ranges[i - 1].compressedSize) fail('ZIP 条目范围重叠', 'INVALID_ARCHIVE')
      // The shared reader still owns its normal archive lifecycle and inventory.
      zip = await ZipArchive.open(file)
      if (zip.entries.length !== entries.length || zip.entries.some((entry, i) => entry.name !== entries[i].name)) fail('ZIP 在读取前发生变化', 'FILE_CHANGED', 409)
      check(op)
      return new PackArchive(zip, handle, entries, op)
    } catch (error) {
      if (zip) await zip.close()
      await handle.close()
      throw error
    }
  }

  entry(name: string): Entry | undefined { return this.entries.find(entry => entry.name === name) }
  async read(name: string, max = MAX_ENTRY_BYTES): Promise<Buffer> {
    check(this.op)
    const entry = this.entry(name)
    if (!entry || entry.isDirectory) fail('缺少 ZIP 文件：' + name, 'INVALID_ARCHIVE')
    size(entry.uncompressedSize, 'ZIP 条目', max)
    const compressed = await readExact(this.handle, entry.compressedSize, entry.start)
    // maxOutputLength is enforced by zlib even when the advertised size is a lie.
    const data = entry.method === 0 ? compressed : await inflate(compressed, { maxOutputLength: Math.max(1, Math.min(max, entry.uncompressedSize)) })
    check(this.op)
    if (data.length !== entry.uncompressedSize || (crc32(data) >>> 0) !== entry.crc32) fail('ZIP 大小或 CRC 校验失败：' + name, 'HASH_MISMATCH')
    return data
  }
  async json(name: string): Promise<unknown> {
    const bytes = await this.read(name, 4 * 1024 * 1024)
    try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)) }
    catch { return fail('整合包清单不是有效 JSON：' + name, 'INVALID_MANIFEST') }
  }
  async close(): Promise<void> {
    try { await this.zip.close() } finally { await this.handle.close() }
  }
}
