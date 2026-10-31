import { describe, expect, it } from 'vitest'
import type { Settings, Instance } from '../src/types.ts'

describe('shared type contract', () => {
  it('accepts a minimally valid settings object', () => {
    const settings: Pick<Settings, 'language' | 'dataDir' | 'concurrency'> = {
      language: 'zh-CN',
      dataDir: null,
      concurrency: 8,
    }
    expect(settings.concurrency).toBe(8)
  })

  it('exposes the instance shape used by the UI', () => {
    const instance = {
      id: '1.20.1-fabric',
      name: '原版档案',
      path: 'E:/x',
      gameVersion: '1.20.1',
      loaders: [{ kind: 'fabric', version: '0.16.9' }],
      javaPath: '',
      memory: { minMb: 512, maxMb: 4096 },
      jvmArgs: [],
      gameArgs: [],
      window: { width: 1280, height: 720, fullscreen: false },
      revision: 1,
      createdAt: 0,
      playTimeMs: 0,
    } satisfies Instance
    expect(instance.loaders[0].kind).toBe('fabric')
  })
})
