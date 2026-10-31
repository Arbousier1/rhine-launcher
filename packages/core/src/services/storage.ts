import type { Context } from '@deepseek-ai/cordis'
import { mkdir, readFile } from 'node:fs/promises'
import { withFileLock, writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { readFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import type { StorageApi } from '../contracts.ts'

/**
 * JSON persistence with atomic writes.
 *
 * Mirrors DSH's `@deepseek-ai/dsh-atomic-write`: writes go to a sibling temp
 * file that is flushed and renamed over the destination, so a crash never
 * leaves a truncated configuration file behind.
 */
export class StorageService implements StorageApi {
  constructor(protected ctx: Context) {
  }

  async read<T>(file: string, fallback: T): Promise<T> {
    try {
      const raw = await readFile(file, 'utf8')
      return JSON.parse(raw) as T
    } catch (error: any) {
      if (error?.code === 'ENOENT') return fallback
      if (error instanceof SyntaxError) {
        this.ctx.logger('storage').warn('配置文件解析失败，已回退到默认值: %s', file)
        return fallback
      }
      throw error
    }
  }

  readSync<T>(file: string, fallback: T): T {
    try {
      return JSON.parse(readFileSync(file, 'utf8')) as T
    } catch {
      return fallback
    }
  }

  async write(file: string, value: unknown, signal?: AbortSignal): Promise<void> {
    signal?.throwIfAborted()
    await mkdir(dirname(file), { recursive: true, mode:0o700 })
    // Directly reuse DSH's permission-preserving wx+rename and cross-process
    // writer lock; committed user data is outside plugin teardown's boundary.
    await withFileLock(file, async () => {
      signal?.throwIfAborted()
      await writeFileAtomic(file,JSON.stringify(value,null,2)+'\n',{mode:0o600,dirMode:0o700})
    },{signal})
  }

  /** Create a directory tree (sync flavour used during boot). */
  ensureDir(path: string): void {
    mkdirSync(path, { recursive: true })
  }
}

