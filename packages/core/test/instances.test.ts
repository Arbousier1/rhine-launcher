import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { installCore, instancesPlugin } from './support/implementation-fixtures.ts'
import {
  DEFAULT_OPTIONS_TXT, INSTANCE_FILE, INSTANCE_SKELETON, InstanceService, defaultInstanceConfig,
  normalizeConfig, resolveInside, toWirePath,
} from '../src/services/instances.ts'
import { sanitizeId } from '../src/services/paths.ts'
import type { RhContext } from '../src/contracts.ts'
import type { InstanceConfig, ServerEvent } from '../src/types.ts'

/** Minimal valid instance config used by most tests. */
function config(overrides: Partial<InstanceConfig> = {}): InstanceConfig {
  return {
    name: '测试档案',
    gameVersion: '1.20.1',
    loaders: [{ kind: 'fabric', version: '0.16.9' }],
    memory: { minMb: 1024, maxMb: 4096 },
    jvmArgs: [],
    gameArgs: [],
    window: { width: 1280, height: 720, fullscreen: false },
    ...overrides,
  }
}

describe('instance helpers', () => {
  it('provides defaults for a new instance', () => {
    const defaults = defaultInstanceConfig('新档案', '1.21.4')
    expect(defaults.name).toBe('新档案')
    expect(defaults.gameVersion).toBe('1.21.4')
    expect(defaults.loaders).toEqual([])
    expect(defaults.memory.maxMb).toBeGreaterThan(0)
    expect(defaults.window.width).toBeGreaterThan(0)
  })

  it('normalises partial configs', () => {
    const normalized = normalizeConfig({
      name: '  Trimmed  ',
      gameVersion: '1.20.1',
      memory: { minMb: 10240, maxMb: 2048 },
      jvmArgs: ['-Dfoo=1', 1 as never],
      window: { width: -5, height: 900, fullscreen: true },
    })
    expect(normalized.name).toBe('Trimmed')
    expect(normalized.memory.minMb).toBeLessThanOrEqual(normalized.memory.maxMb)
    expect(normalized.jvmArgs).toEqual(['-Dfoo=1'])
    expect(normalized.window.width).toBe(0)
    expect(normalized.window.fullscreen).toBe(true)
  })

  it('keeps memory inside sane bounds', () => {
    expect(normalizeConfig({ memory: { minMb: 1, maxMb: 999999 } }).memory.minMb).toBe(256)
    expect(normalizeConfig({ memory: { minMb: 1, maxMb: 999999 } }).memory.maxMb).toBe(65536)
  })

  it('rejects directory traversal', () => {
    expect(resolveInside('E:/instances/a', 'mods/x.jar')).toContain('mods')
    expect(() => resolveInside('E:/instances/a', '../b')).toThrow(/越界/)
    expect(() => resolveInside('E:/instances/a', 'E:/windows/system32')).toThrow(/绝对路径/)
    expect(() => resolveInside('E:/instances/a', '')).toThrow(/不能为空/)
  })

  it('converts absolute paths to wire paths', () => {
    const root = join('E:', 'instances', 'a')
    expect(toWirePath(root, join(root, 'mods', 'x.jar'))).toBe('mods/x.jar')
  })
})

describe('InstanceService', () => {
  let root = ''
  let ctx: RhContext
  let events: ServerEvent[]

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'rhine-instances-'))
    ctx = new Context() as unknown as RhContext
    await installCore(ctx as never, { root })
    await (ctx.plugin(instancesPlugin as never) as unknown as PromiseLike<unknown>)
    await ctx.paths.ensure()
    events = []
    ctx.bus.subscribe((event) => events.push(event))
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('creates the .minecraft skeleton and a default options.txt', async () => {
    const instance = await ctx.instances.create(config())
    expect(instance.id).toBe('测试档案')
    expect(instance.path.endsWith(instance.id)).toBe(true)
    expect(instance.revision).toBeGreaterThan(0)
    expect(instance.playTimeMs).toBe(0)

    for (const dir of INSTANCE_SKELETON) {
      const info = await stat(join(instance.path, ...dir.split('/'))).catch(() => undefined)
      expect(info?.isDirectory(), dir).toBe(true)
    }
    const options = await readFile(join(instance.path, 'options.txt'), 'utf8')
    expect(options).toBe(DEFAULT_OPTIONS_TXT)
    expect(options).toContain('lang:zh_cn')

    const stored = JSON.parse(await readFile(join(instance.path, INSTANCE_FILE), 'utf8'))
    expect(stored.name).toBe('测试档案')
    expect(stored.gameVersion).toBe('1.20.1')
    expect(events.some((event) => event.type === 'instance')).toBe(true)
  })

  it('lists and reads an instance', async () => {
    const list = ctx.instances.list()
    expect(list).toHaveLength(1)
    expect(list[0].name).toBe('测试档案')
    expect(ctx.instances.get(list[0].id)?.gameVersion).toBe('1.20.1')
    expect(ctx.instances.get('missing')).toBeUndefined()
  })

  it('allocates a unique id for duplicate names', async () => {
    const second = await ctx.instances.create(config({ name: '测试档案' }))
    expect(second.id).not.toBe('测试档案')
    expect(second.id).toMatch(/^测试档案-\d+$/)
  })

  it('updates config and bumps the revision', async () => {
    const instance = ctx.instances.list().find((item) => item.id === '测试档案')!
    const updated = await ctx.instances.update(instance.id, { memory: { minMb: 2048, maxMb: 8192 } })
    expect(updated.memory.maxMb).toBe(8192)
    expect(updated.revision).toBeGreaterThan(instance.revision)
    expect(updated.name).toBe('测试档案')

    const stored = JSON.parse(await readFile(join(instance.path, INSTANCE_FILE), 'utf8'))
    expect(stored.memory.maxMb).toBe(8192)
  })

  it('lists files with directories first', async () => {
    const instance = ctx.instances.list().find((item) => item.id === '测试档案')!
    await writeFile(join(instance.path, 'mods', 'a.jar'), 'x')
    const files = await ctx.instances.files(instance.id)
    expect(files.length).toBeGreaterThan(3)
    expect(files[0].isDirectory).toBe(true)
    const mods = await ctx.instances.files(instance.id, 'mods')
    expect(mods.map((file) => file.name)).toContain('a.jar')
    expect(mods[0].path).toBe('mods/a.jar')
    expect(await ctx.instances.files(instance.id, 'nope')).toEqual([])
  })

  it('reads and writes instance files', async () => {
    const instance = ctx.instances.list().find((item) => item.id === '测试档案')!
    await ctx.instances.writeFile(instance.id, 'config/custom.json', '{"a":1}')
    expect(await ctx.instances.readFile(instance.id, 'config/custom.json')).toBe('{"a":1}')
    await ctx.instances.writeFile(instance.id, 'options.txt', 'fov:0.5\n')
    expect(await ctx.instances.readFile(instance.id, 'options.txt')).toBe('fov:0.5\n')

    await expect(ctx.instances.readFile(instance.id, 'missing.txt')).rejects.toThrow(/不存在/)
    await expect(ctx.instances.writeFile(instance.id, '../escape.txt', 'x')).rejects.toThrow(/越界/)
  })

  it('deletes files but never the descriptor', async () => {
    const instance = ctx.instances.list().find((item) => item.id === '测试档案')!
    await ctx.instances.writeFile(instance.id, 'config/remove-me.json', '{}')
    await ctx.instances.deleteFile(instance.id, 'config/remove-me.json')
    await expect(ctx.instances.readFile(instance.id, 'config/remove-me.json')).rejects.toThrow()
    await expect(ctx.instances.deleteFile(instance.id, INSTANCE_FILE)).rejects.toThrow(/不能删除/)
  })

  it('duplicates an instance with its game data but not the logs', async () => {
    const instance = ctx.instances.list().find((item) => item.id === '测试档案')!
    await writeFile(join(instance.path, 'mods', 'copy.jar'), 'data')
    await writeFile(join(instance.path, '.rhine', 'secret.txt'), 'internal')
    const copy = await ctx.instances.duplicate(instance.id, '副本档案')
    expect(copy.id).toBe('副本档案')
    expect(copy.name).toBe('副本档案')
    expect(await readFile(join(copy.path, 'mods', 'copy.jar'), 'utf8')).toBe('data')
    expect(await readdir(join(copy.path, '.rhine'))).not.toContain('secret.txt')
    const files = await ctx.instances.files(copy.id)
    expect(files.some((file) => file.name === INSTANCE_FILE)).toBe(true)
  })

  it('records launches and play time', async () => {
    const instance = ctx.instances.list().find((item) => item.id === '测试档案')!
    const before = ctx.instances.get(instance.id)!
    const launched = await ctx.instances.markLaunched(instance.id)
    expect(launched.lastLaunchedAt).toBeGreaterThan(0)
    expect(launched.revision).toBeGreaterThan(before.revision)

    await ctx.instances.addPlayTime(instance.id, 1234)
    const played = ctx.instances.get(instance.id)!
    expect(played.playTimeMs).toBeGreaterThanOrEqual(1234)

    await ctx.instances.addPlayTime(instance.id, 0)
    await ctx.instances.addPlayTime('ghost', 10)
  })

  it('removes an instance and its files', async () => {
    const instance = ctx.instances.list().find((item) => item.id === '副本档案')!
    events.length = 0
    await ctx.instances.remove(instance.id)
    expect(ctx.instances.get(instance.id)).toBeUndefined()
    expect(await stat(instance.path).catch(() => undefined)).toBeUndefined()
    expect(events.some((event) => event.type === 'instance-removed' && event.id === instance.id)).toBe(true)
  })

  it('keeps user files when deleteFiles is false', async () => {
    const keep = ctx.instances.list().find((item) => item.id !== '测试档案')!
    await ctx.instances.remove(keep.id, { deleteFiles: false })
    expect(ctx.instances.get(keep.id)).toBeUndefined()
    // The directory still exists but is no longer an instance.
    expect(await stat(keep.path)).toBeTruthy()
    expect(ctx.instances.list().some((item) => item.id === keep.id)).toBe(false)
  })

  it('sanitises ids that collide with path separators', async () => {
    expect(sanitizeId('a/b')).toBe('a_b')
    const instance = await ctx.instances.create(config({ name: 'a/b' }))
    expect(instance.id).not.toContain('/')
    expect(instance.path).toContain(root)
  })

  it('ignores directories without an instance.json', async () => {
    await mkdir(join(ctx.paths.get().instances, 'not-an-instance'), { recursive: true })
    const ids = ctx.instances.list().map((item) => item.id)
    expect(ids).not.toContain('not-an-instance')
  })

  it('throws a Chinese error for unknown instances', async () => {
    await expect(ctx.instances.update('ghost', { name: 'x' })).rejects.toThrow(/实例不存在/)
    await expect(ctx.instances.remove('ghost')).rejects.toThrow(/实例不存在/)
    await expect(ctx.instances.files('ghost')).rejects.toThrow(/实例不存在/)
  })

  it('can be constructed directly for unit tests', () => {
    const service = new InstanceService(new Context())
    expect(Object.getPrototypeOf(service)).toBeInstanceOf(Object)
    void ctx
  })
})
