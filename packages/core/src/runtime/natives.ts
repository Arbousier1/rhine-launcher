/**
 * Native library extraction.
 *
 * Minecraft ships its JNI libraries as classifier jars (`*-natives-windows.jar`)
 * that must be unpacked into a directory passed through `-Djava.library.path`.
 * HMCL does this with `Unzipper`; we reuse the launcher's own ZIP reader so no
 * extra dependency is needed.
 */
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { dirname, join, sep } from 'node:path'
import { ZipArchive } from '../mods/zip.ts'

/** Raised when a natives archive cannot be unpacked. */
export class NativesError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NativesError'
  }
}

/** Result of {@link extractNatives}. */
export interface NativesResult {
  /** Files written, relative to the destination directory. */
  files: string[]
  /** Files skipped because of an exclusion rule. */
  skipped: number
}

/**
 * Should an archive path be extracted?
 *
 * The Minecraft launcher always drops `META-INF/` (signatures would break once
 * the jar is repacked) and honours the library's own `extract.exclude` list.
 */
export function shouldExtract(entryName: string, excludes: string[]): boolean {
  if (!entryName || entryName.endsWith('/')) return false
  const posix = entryName.replace(/\\/g, '/')
  // Path traversal guard: never write outside the natives directory.
  if (posix.startsWith('/') || /^[A-Za-z]:/.test(posix)) return false
  if (posix.split('/').some((segment) => segment === '..')) return false
  for (const exclude of excludes) {
    if (!exclude) continue
    const prefix = exclude.replace(/\\/g, '/').replace(/\/+$/, '')
    if (prefix && (posix === prefix || posix.startsWith(prefix + '/'))) return false
  }
  return true
}

/** Remove every file inside a directory without deleting the directory itself. */
export async function cleanDirectory(directory: string): Promise<void> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => [])
  await Promise.all(entries.map((entry) =>
    rm(join(directory, entry.name), { recursive: true, force: true })))
}

/**
 * Extract one natives jar into `destination`.
 *
 * Existing files with the same size are left untouched, which mirrors HMCL's
 * behaviour and makes repeated launches cheap.
 */
export async function extractNatives(
  jarPath: string,
  destination: string,
  excludes: string[] = ['META-INF/'],
): Promise<NativesResult> {
  await mkdir(destination, { recursive: true })
  const info = await stat(jarPath).catch(() => undefined)
  if (!info?.isFile()) throw new NativesError('原生库文件不存在：' + jarPath)

  let archive: ZipArchive
  try {
    archive = await ZipArchive.open(jarPath)
  } catch (error) {
    throw new NativesError('无法读取原生库压缩包：' + jarPath + '（' + (error as Error).message + '）')
  }

  const written: string[] = []
  let skipped = 0
  try {
    for (const entry of archive.entries) {
      if (entry.isDirectory) continue
      if (!shouldExtract(entry.name, excludes)) {
        skipped++
        continue
      }
      const target = join(destination, ...entry.name.replace(/\\/g, '/').split('/'))
      const relative = entry.name.replace(/\\/g, '/')
      const existing = await stat(target).catch(() => undefined)
      if (existing?.isFile() && existing.size === entry.uncompressedSize) {
        written.push(relative)
        continue
      }
      const data = await archive.read(entry.name)
      if (!data) {
        skipped++
        continue
      }
      await mkdir(dirname(target), { recursive: true })
      await writeFile(target, data)
      written.push(relative)
    }
  } finally {
    await archive.close().catch(() => {})
  }

  if (written.length === 0) {
    throw new NativesError('原生库压缩包内没有可解压的文件：' + jarPath)
  }
  return { files: written, skipped }
}

/** Extract several natives jars into the same directory, first failure wins. */
export async function extractAllNatives(
  jars: { path: string; exclude?: string[] }[],
  destination: string,
  clean = true,
): Promise<NativesResult> {
  if (clean) await cleanDirectory(destination)
  const files: string[] = []
  let skipped = 0
  for (const jar of jars) {
    const result = await extractNatives(jar.path, destination, jar.exclude ?? ['META-INF/'])
    files.push(...result.files)
    skipped += result.skipped
  }
  return { files, skipped }
}

/** Join path fragments with the platform separator (helper for tests). */
export function nativesPath(dir: string, name: string): string {
  return join(dir, name)
}

/** Platform specific native file extensions used by diagnostics. */
export function nativeExtensions(platform: 'windows' | 'osx' | 'linux'): string[] {
  if (platform === 'windows') return ['.dll']
  if (platform === 'osx') return ['.dylib', '.jnilib']
  return ['.so']
}

/** Separator constant re-exported so callers do not import node:path twice. */
export const PATH_SEP = sep
