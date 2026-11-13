import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { fileURLToPath } from 'node:url'
import { ensureBackend, type BackendHandle } from '../src/backend.cjs'
const repository = fileURLToPath(new URL('../../../', import.meta.url))

describe('desktop owns its backend lifecycle', () => {
  it('cold-starts on a dynamic port, borrows only matching data, and stops only its own process', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'rhine-desktop-backend-test-'))
    let owned: BackendHandle | undefined
    try {
      owned = await ensureBackend({ repository, dataDirectory, port: 0, executable: process.execPath })
      expect(owned.owned).toBe(true)
      const port = Number(new URL(owned.origin).port)
      expect(port).toBeGreaterThan(0)
      const bootstrap = await (await fetch(owned.origin + '/api/bootstrap')).json()
      expect(bootstrap.app.pid).toBe(owned.pid)
      expect(bootstrap.paths.root).toBe(dataDirectory)
      const borrowed = await ensureBackend({ repository, dataDirectory, port, executable: process.execPath })
      expect(borrowed.owned).toBe(false)
      await borrowed.stop()
      expect((await fetch(owned.origin + '/api/health')).status).toBe(200)
      await expect(ensureBackend({ repository, dataDirectory: join(dataDirectory, 'other'), port, executable: process.execPath })).rejects.toThrow('其他数据目录')
      await owned.stop()
      await owned.stop()
      await expect(fetch(owned.origin + '/api/health')).rejects.toThrow()
    } finally {
      await owned?.stop()
      await rm(dataDirectory, { recursive: true, force: true })
    }
  }, 40000)
  it('reports a missing executable promptly instead of waiting on a nonexistent child', async () => {
    const dataDirectory = await mkdtemp(join(tmpdir(), 'rhine-desktop-backend-test-'))
    try {
      await expect(ensureBackend({ repository, dataDirectory, port: 0, executable: join(dataDirectory, 'missing-executable'), timeoutMs: 1000 })).rejects.toThrow()
    } finally { await rm(dataDirectory, { recursive: true, force: true }) }
  })
})
