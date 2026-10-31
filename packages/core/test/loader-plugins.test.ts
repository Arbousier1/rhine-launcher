import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { FeatureRuntime, defineFeature } from '@rhine/plugin-api'
import type { DownloadOptions, RhPaths } from '../src/contracts.ts'
import type { JavaRuntime } from '../src/types.ts'
import { readInstalledVersions } from '../src/loader/versions.ts'
import fabricList from '../src/plugins/features/loaders/fabric-list.plugin.ts'
import fabricInstall from '../src/plugins/features/loaders/fabric-install.plugin.ts'
import quiltList from '../src/plugins/features/loaders/quilt-list.plugin.ts'
import quiltInstall from '../src/plugins/features/loaders/quilt-install.plugin.ts'
import forgeList from '../src/plugins/features/loaders/forge-list.plugin.ts'
import forgeInstall from '../src/plugins/features/loaders/forge-install.plugin.ts'
import neoforgeList from '../src/plugins/features/loaders/neoforge-list.plugin.ts'
import neoforgeInstall from '../src/plugins/features/loaders/neoforge-install.plugin.ts'
import optifineList from '../src/plugins/features/loaders/optifine-list.plugin.ts'
import optifineInstall from '../src/plugins/features/loaders/optifine-install.plugin.ts'
import detectPlugin from '../src/plugins/features/loaders/detect.plugin.ts'
import { decodeDetectInput, decodeListInput, decodeInstallInput } from '../src/plugins/features/loaders/support.ts'

const LOADER_IDS = [
  'loader.fabric.list', 'loader.fabric.install',
  'loader.quilt.list', 'loader.quilt.install',
  'loader.forge.list', 'loader.forge.install',
  'loader.neoforge.list', 'loader.neoforge.install',
  'loader.optifine.list', 'loader.optifine.install',
  'loader.detect',
]

const FABRIC_LIST_URL = 'https://meta.fabricmc.net/v2/versions/loader/1.20.1'
const FABRIC_PROFILE_URL = 'https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.16.9/profile/json'
const QUILT_LIST_URL = 'https://meta.quiltmc.org/v3/versions/loader/1.20.1'
const FABRIC_PROFILE = JSON.stringify({
  id: 'fabric-loader-0.16.9-1.20.1',
  inheritsFrom: '1.20.1',
  mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
  libraries: [{ name: 'net.fabricmc:intermediary:1.20.1' }],
})

function pathsOf(root: string): RhPaths {
  return {
    root,
    instances: join(root, 'instances'),
    assets: join(root, 'assets'),
    libraries: join(root, 'libraries'),
    versions: join(root, 'versions'),
    java: join(root, 'java'),
    logs: join(root, 'logs'),
    temp: join(root, 'temp'),
  }
}

function runtime(): JavaRuntime {
  return { path: 'C:/fake-jdk/bin/java.exe', version: '17.0.15', majorVersion: 17, vendor: 'Test', arch: 'x64', managed: false }
}

interface HarnessOptions {
  text?: (url: string) => Promise<string>
  file?: (options: DownloadOptions) => Promise<number>
  verify?: (id: string) => Promise<boolean>
  installed?: () => Promise<string[]>
}

interface Harness {
  features: FeatureRuntime
  root: string
  textCalls: string[]
  fileCalls: string[]
}

/**
 * Register minimal single-capability base stubs plus every loader plugin.
 *
 * The stubs implement only the documented capability contract (paths.get,
 * download.text/file, version.*, java.*), so the loader plugins run exactly as
 * they will in production.
 */
async function createHarness(root: string, options: HarnessOptions = {}): Promise<Harness> {
  const features = new FeatureRuntime()
  const textCalls: string[] = []
  const fileCalls: string[] = []
  const paths = pathsOf(root)
  const text = options.text ?? (async (url: string) => {
    if (url === FABRIC_LIST_URL) return JSON.stringify([{ loader: { version: '0.16.9', stable: true } }])
    if (url === FABRIC_PROFILE_URL) return FABRIC_PROFILE
    if (url === QUILT_LIST_URL) return JSON.stringify([{ loader: { version: '0.24.0', stable: true } }])
    throw new Error('no fixture for ' + url)
  })
  const file = options.file ?? (async () => { throw new Error('download.file not stubbed') })
  const verify = options.verify ?? (async (id: string) => {
    try { await stat(join(paths.versions, id, id + '.json')); return true } catch { return false }
  })
  const installed = options.installed ?? (async () => (await readInstalledVersions(paths.versions)).map((item) => item.id))

  features.register(defineFeature<unknown, RhPaths>({
    id: 'paths.get', capability: 'paths.get', title: 'paths.get',
    execute: () => paths,
  }))
  features.register(defineFeature<string, Promise<string>>({
    id: 'download.text', capability: 'download.text', title: 'download.text',
    execute: async (input) => { textCalls.push(String(input)); return text(String(input)) },
  }))
  features.register(defineFeature<DownloadOptions, Promise<number>>({
    id: 'download.file', capability: 'download.file', title: 'download.file',
    execute: async (input) => { fileCalls.push(input.url); return file(input) },
  }))
  features.register(defineFeature<{ id: string }, Promise<boolean>>({
    id: 'version.verify', capability: 'version.verify', title: 'version.verify',
    execute: (input) => verify(input.id),
  }))
  features.register(defineFeature<unknown, Promise<string[]>>({
    id: 'version.installed', capability: 'version.installed', title: 'version.installed',
    execute: () => installed(),
  }))
  features.register(defineFeature<{ gameVersion: string }, Promise<void>>({
    id: 'version.install', capability: 'version.install', title: 'version.install',
    execute: async (input) => {
      await mkdir(join(paths.versions, input.gameVersion), { recursive: true })
      await writeFile(join(paths.versions, input.gameVersion, input.gameVersion + '.json'), JSON.stringify({ id: input.gameVersion }))
      await writeFile(join(paths.versions, input.gameVersion, input.gameVersion + '.jar'), 'jar')
    },
  }))
  features.register(defineFeature<{ majorVersion: number }, JavaRuntime | undefined>({
    id: 'java.pick', capability: 'java.pick', title: 'java.pick',
    execute: () => runtime(),
  }))
  features.register(defineFeature<unknown, Promise<JavaRuntime[]>>({
    id: 'java.scan', capability: 'java.scan', title: 'java.scan',
    execute: async () => [runtime()],
  }))

  for (const plugin of [
    fabricList, fabricInstall, quiltList, quiltInstall, forgeList, forgeInstall,
    neoforgeList, neoforgeInstall, optifineList, optifineInstall, detectPlugin,
  ]) {
    features.register(plugin)
  }
  await features.start()
  return { features, root, textCalls, fileCalls }
}

const roots: string[] = []
const harnesses: FeatureRuntime[] = []

afterEach(async () => {
  while (harnesses.length > 0) {
    await harnesses.pop()!.dispose()
  }
  while (roots.length > 0) {
    await rm(roots.pop()!, { recursive: true, force: true })
  }
})

async function setup(options: HarnessOptions = {}): Promise<Harness> {
  const root = await mkdtemp(join(tmpdir(), 'rhine-loader-plugins-'))
  roots.push(root)
  const harness = await createHarness(root, options)
  harnesses.push(harness.features)
  return harness
}

function snapshotOf(harness: Harness, id: string) {
  return harness.features.list().find((item) => item.id === id)
}

describe('loader feature catalog', () => {
  it('registers one capability per action', async () => {
    const harness = await setup()
    const loaderDefinitions = harness.features.definitions().filter((definition) => definition.id.startsWith('loader.'))
    expect(loaderDefinitions.map((definition) => definition.id).sort()).toEqual([...LOADER_IDS].sort())
    for (const definition of loaderDefinitions) {
      expect(definition.capability).toBe(definition.id)
      expect(typeof definition.execute).toBe('function')
      expect(definition.depends?.includes(definition.id)).toBe(false)
    }
    expect(harness.features.has('loader.detect')).toBe(true)
    expect(harness.features.has('loader.fabric.list')).toBe(true)
  })

  it('declares one HTTP action per plugin with the legacy routes', async () => {
    const harness = await setup()
    const definitions = harness.features.definitions().filter((definition) => definition.id.startsWith('loader.'))
    for (const definition of definitions) {
      expect(definition.http).toBeDefined()
      expect(definition.http?.path.startsWith('/api/')).toBe(true)
    }
    expect(harness.features.definition('loader.detect')?.http?.path).toBe('/api/versions/:gameVersion/loaders')
    expect(harness.features.definition('loader.fabric.install')?.http).toMatchObject({
      method: 'POST',
      path: '/api/loaders/fabric/install',
      background: { kind: 'loader-install', title: '安装 Fabric 加载器' },
    })
    expect(harness.features.definition('loader.optifine.list')?.http).toMatchObject({ method: 'GET', path: '/api/loaders/optifine' })
  })

  it('decodes query, body and path-parameter inputs', async () => {
    expect(decodeListInput(new Request('http://localhost/api/loaders/fabric?gameVersion=1.20.1'))).toEqual({ gameVersion: '1.20.1' })
    expect(decodeDetectInput(new Request('http://localhost/api/versions/1.20.1/loaders'))).toEqual({ gameVersion: '1.20.1' })
    expect(decodeDetectInput(new Request('http://localhost/api/versions/ignored/loaders'), { gameVersion: '1.21.1' }))
      .toEqual({ gameVersion: '1.21.1' })
    const install = await decodeInstallInput(new Request('http://localhost/api/loaders/fabric/install', {
      method: 'POST',
      body: JSON.stringify({ gameVersion: '1.20.1', loaderVersion: '0.16.9' }),
    }))
    expect(install).toEqual({ gameVersion: '1.20.1', loaderVersion: '0.16.9' })
    await expect(decodeInstallInput(new Request('http://localhost/api/loaders/fabric/install', {
      method: 'POST',
      body: 'not json',
    }))).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
  })

  it('lists fabric builds through the download.text capability', async () => {
    const harness = await setup()
    const versions = await harness.features.call('loader.fabric.list', { gameVersion: '1.20.1' }) as { version: string }[]
    expect(versions.map((item) => item.version)).toEqual(['0.16.9'])
    expect(harness.textCalls).toContain(FABRIC_LIST_URL)
  })

  it('rejects invalid inputs with a validation error', async () => {
    const harness = await setup()
    await expect(harness.features.call('loader.fabric.list', { gameVersion: '' })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' })
    expect(() => harness.features.call('loader.fabric.install', { gameVersion: '1.20.1', loaderVersion: '' }))
      .toThrow(/loaderVersion/)
  })
})

describe('loader feature isolation', () => {
  it('disables only the requested feature and leaves siblings enabled', async () => {
    const harness = await setup()
    await harness.features.disable('loader.fabric.list')
    expect(snapshotOf(harness, 'loader.fabric.list')?.status).toBe('disabled')
    for (const id of LOADER_IDS.filter((item) => item !== 'loader.fabric.list')) {
      expect(snapshotOf(harness, id)?.status).toBe('enabled')
    }
    expect(() => harness.features.call('loader.fabric.list', { gameVersion: '1.20.1' })).toThrow(/未启用/)
    const quilt = await harness.features.call('loader.quilt.list', { gameVersion: '1.20.1' }) as unknown[]
    expect(Array.isArray(quilt)).toBe(true)
    await harness.features.enable('loader.fabric.list')
    expect(harness.features.has('loader.fabric.list')).toBe(true)
  })

  it('blocks dependents when download.text is disabled but keeps detect alive', async () => {
    const harness = await setup()
    await harness.features.disable('download.text')
    expect(snapshotOf(harness, 'download.text')?.status).toBe('disabled')
    expect(snapshotOf(harness, 'loader.fabric.list')?.status).toBe('blocked')
    expect(snapshotOf(harness, 'loader.forge.install')?.status).toBe('blocked')
    expect(snapshotOf(harness, 'loader.detect')?.status).toBe('enabled')

    await harness.features.enable('download.text')
    expect(harness.features.has('download.text')).toBe(true)
    expect(harness.features.has('loader.fabric.list')).toBe(true)
    expect(harness.features.has('loader.forge.install')).toBe(true)
    const versions = await harness.features.call('loader.fabric.list', { gameVersion: '1.20.1' }) as unknown[]
    expect(versions).toHaveLength(1)
  })

  it('reports a blocked plugin when a dependency is missing, then recovers', async () => {
    const features = new FeatureRuntime()
    features.register(fabricList)
    await features.start()
    expect(snapshotOf({ features } as Harness, 'loader.fabric.list')?.status).toBe('blocked')
    expect(() => features.call('loader.fabric.list', { gameVersion: '1.20.1' })).toThrow(/未启用|缺少依赖/)

    features.register(defineFeature<string, Promise<string>>({
      id: 'download.text', capability: 'download.text', title: 'download.text',
      execute: async () => JSON.stringify([{ loader: { version: '0.16.9', stable: true } }]),
    }))
    await features.enable('download.text')
    expect(features.has('loader.fabric.list')).toBe(true)
    const versions = await features.call('loader.fabric.list', { gameVersion: '1.20.1' }) as unknown[]
    expect(versions).toHaveLength(1)
    await features.dispose()
  })

  it('keeps a plugin enabled when its action throws', async () => {
    const harness = await setup({
      text: async (url) => { throw new Error('mirror down: ' + url) },
    })
    await expect(harness.features.call('loader.forge.list', { gameVersion: '1.20.1' })).rejects.toThrow(/无法获取 Forge 版本列表/)
    expect(snapshotOf(harness, 'loader.forge.list')?.status).toBe('enabled')
    expect(harness.features.has('loader.forge.list')).toBe(true)
  })
})

describe('loader feature actions', () => {
  it('installs fabric and detects it via separate capabilities', async () => {
    const harness = await setup()
    const id = await harness.features.call('loader.fabric.install', {
      gameVersion: '1.20.1',
      loaderVersion: '0.16.9',
    }) as string
    expect(id).toBe('fabric-loader-0.16.9-1.20.1')
    const json = JSON.parse(await readFile(join(harness.root, 'versions', id, id + '.json'), 'utf8')) as { mainClass: string }
    expect(json.mainClass).toContain('net.fabricmc')
    const specs = await harness.features.call('loader.detect', { gameVersion: '1.20.1' }) as { kind: string; version?: string }[]
    expect(specs).toEqual([{ kind: 'fabric', version: '0.16.9' }])
  })

  it('rolls back a failed profile install and stays enabled', async () => {
    const harness = await setup({
      text: async (url) => {
        if (url === FABRIC_PROFILE_URL) return 'not json'
        if (url === FABRIC_LIST_URL) return JSON.stringify([{ loader: { version: '0.16.9', stable: true } }])
        throw new Error('no fixture')
      },
    })
    await expect(harness.features.call('loader.fabric.install', { gameVersion: '1.20.1', loaderVersion: '0.16.9' }))
      .rejects.toThrow(/不是合法的 JSON/)
    expect(await stat(join(harness.root, 'versions', 'fabric-loader-0.16.9-1.20.1')).catch(() => undefined)).toBeUndefined()
    expect(snapshotOf(harness, 'loader.fabric.install')?.status).toBe('enabled')
  })

  it('rolls back a forge install when the installer download fails', async () => {
    const harness = await setup({
      text: async (url) => {
        if (url.endsWith('.sha1') || url.endsWith('.sha256')) throw new Error('missing checksum')
        if (url.includes('maven-metadata')) return '<metadata><versioning><versions><version>1.20.1-47.2.0</version></versions></versioning></metadata>'
        throw new Error('no fixture: ' + url)
      },
      file: async () => { throw new Error('network down') },
    })
    await expect(harness.features.call('loader.forge.install', { gameVersion: '1.20.1', loaderVersion: '47.2.0' }))
      .rejects.toThrow(/下载 Forge 安装器失败/)
    expect(await stat(join(harness.root, 'versions', '1.20.1-forge-47.2.0')).catch(() => undefined)).toBeUndefined()
    expect(snapshotOf(harness, 'loader.forge.install')?.status).toBe('enabled')
    expect(snapshotOf(harness, 'loader.forge.list')?.status).toBe('enabled')
  })
})