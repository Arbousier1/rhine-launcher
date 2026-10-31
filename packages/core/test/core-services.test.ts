import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { buildPaths, sanitizeId } from '../src/services/paths.ts'
import { installCore } from './support/implementation-fixtures.ts'
import type { ServerEvent } from '../src/types.ts'

describe('paths', () => {
  it('builds the HMCL-compatible layout', () => {
    const paths = buildPaths('E:/rhine')
    expect(paths.instances).toBe('E:\\rhine\\instances')
    expect(paths.versions).toBe('E:\\rhine\\versions')
    expect(paths.libraries).toBe('E:\\rhine\\libraries')
  })

  it('rejects traversal in instance ids', () => {
    expect(sanitizeId('../evil')).not.toContain('..')
    expect(sanitizeId('a/b')).toBe('a_b')
  })
})

describe('core services', () => {
  it('installs foundation services and persists settings', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-core-'))
    try {
      const ctx = new Context()
      await installCore(ctx, { root: dir })
      await ctx.paths.ensure()
      const settings = ctx.settings.get()
      expect(settings.concurrency).toBe(8)

      const updated = await ctx.settings.update({ concurrency: 4, language: 'en-US' })
      expect(updated.concurrency).toBe(4)

      const events: ServerEvent[] = []
      ctx.bus.subscribe((event) => events.push(event))
      await ctx.settings.update({ theme: 'midnight' })
      expect(events.some((event) => event.type === 'settings')).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('runs a task and fans out progress', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-task-'))
    try {
      const ctx = new Context()
      await installCore(ctx, { root: dir })
      const events: ServerEvent[] = []
      ctx.bus.subscribe((event) => events.push(event))

      const id = ctx.tasks.run('测试任务', 'test', async (handle) => {
        handle.setProgress({ current: 1, total: 2, value: 0.5, stage: 'download' })
        handle.log('halfway')
      })
      const snapshot = await ctx.tasks.wait(id)
      expect(snapshot.status).toBe('succeeded')
      expect(events.filter((event) => event.type === 'task').length).toBeGreaterThan(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('marks a cancelled task as cancelled', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-cancel-'))
    try {
      const ctx = new Context()
      await installCore(ctx, { root: dir })
      const id = ctx.tasks.run('长任务', 'test', async (handle) => {
        for (let index = 0; index < 100; index++) {
          handle.throwIfCancelled()
          await new Promise((resolve) => setTimeout(resolve, 5))
        }
      })
      await new Promise((resolve) => setTimeout(resolve, 20))
      ctx.tasks.cancel(id)
      const snapshot = await ctx.tasks.wait(id)
      expect(snapshot.status).toBe('cancelled')
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })
})
