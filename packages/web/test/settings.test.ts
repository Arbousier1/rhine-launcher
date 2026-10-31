import { describe, expect, it } from 'vitest'
import type { Settings } from '@rhine/core'
import {
  clampInt, cloneSettings, diffSettings, isHttpUrl, isValidSettings, LIMITS, maskSecret,
  stableStringify, validateSettings,
} from '../src/features/settings/settings.ts'

function settings(partial: Partial<Settings> = {}): Settings {
  return {
    language: 'zh-CN',
    dataDir: null,
    concurrency: 8,
    mirrors: {
      versionManifest: 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',
      launcherMeta: 'https://piston-meta.mojang.com',
      assets: 'https://resources.download.minecraft.net',
      maven: 'https://libraries.minecraft.net',
      fabric: 'https://meta.fabricmc.net/v2',
      forge: 'https://maven.minecraftforge.net',
      neoforge: 'https://maven.neoforged.net/releases',
      quilt: 'https://meta.quiltmc.org/v3',
      modrinth: 'https://api.modrinth.com/v2',
      curseforge: 'https://api.curseforge.com/v1',
    },
    autoDownloadJava: true,
    keepLogs: 10,
    showSnapshots: false,
    downloadSource: 'official',
    theme: 'archive',
    ...partial,
  }
}

describe('isHttpUrl', () => {
  it('accepts http and https only', () => {
    expect(isHttpUrl('https://a.b')).toBe(true)
    expect(isHttpUrl('http://a.b/c')).toBe(true)
    expect(isHttpUrl('ftp://a.b')).toBe(false)
    expect(isHttpUrl('a.b')).toBe(false)
    expect(isHttpUrl('')).toBe(false)
  })
})

describe('validateSettings', () => {
  it('accepts the defaults', () => {
    expect(validateSettings(settings())).toEqual({})
    expect(isValidSettings(settings())).toBe(true)
  })

  it('rejects an out-of-range concurrency', () => {
    expect(validateSettings(settings({ concurrency: 0 })).concurrency).toContain('并发数')
    expect(validateSettings(settings({ concurrency: 65 })).concurrency).toContain('并发数')
    expect(validateSettings(settings({ concurrency: 4.5 })).concurrency).toContain('并发数')
  })

  it('rejects an out-of-range keepLogs', () => {
    expect(validateSettings(settings({ keepLogs: 0 })).keepLogs).toContain('保留日志数')
    expect(validateSettings(settings({ keepLogs: 201 })).keepLogs).toContain('保留日志数')
  })

  it('validates every mirror url', () => {
    const base = settings()
    const broken = { ...base, mirrors: { ...base.mirrors, maven: 'not-a-url' } }
    expect(validateSettings(broken)['mirrors.maven']).toContain('http(s)')
    const empty = { ...base, mirrors: { ...base.mirrors, fabric: '  ' } }
    expect(validateSettings(empty)['mirrors.fabric']).toContain('不能为空')
  })

  it('validates proxy only when enabled', () => {
    const base = settings()
    expect(validateSettings({ ...base, proxy: { enabled: false, host: '', port: 0 } })).toEqual({})
    const errors = validateSettings({ ...base, proxy: { enabled: true, host: '', port: 0 } })
    expect(errors['proxy.host']).toBeDefined()
    expect(errors['proxy.port']).toContain('端口')
    expect(validateSettings({ ...base, proxy: { enabled: true, host: '127.0.0.1', port: 7890 } })).toEqual({})
  })

  it('rejects unknown language and theme values', () => {
    expect(validateSettings(settings({ language: 'fr-FR' as Settings['language'] })).language).toBeDefined()
    expect(validateSettings(settings({ theme: 'neon' as Settings['theme'] })).theme).toBeDefined()
  })

  it('rejects a malformed CurseForge key but allows an empty one', () => {
    expect(validateSettings(settings({ curseforgeApiKey: '' })).curseforgeApiKey).toBeUndefined()
    expect(validateSettings(settings({ curseforgeApiKey: 'bad key with spaces' })).curseforgeApiKey).toBeDefined()
    expect(validateSettings(settings({ curseforgeApiKey: '$2a$10$abcdefghijklmnop' })).curseforgeApiKey).toBeUndefined()
  })
})

describe('diffSettings', () => {
  it('returns an empty patch for identical settings', () => {
    expect(diffSettings(settings(), settings())).toEqual({})
  })

  it('detects scalar changes only', () => {
    const patch = diffSettings(settings(), settings({ concurrency: 16, theme: 'midnight' }))
    expect(patch).toEqual({ concurrency: 16, theme: 'midnight' })
  })

  it('detects nested mirror changes as one unit', () => {
    const base = settings()
    const next = settings({ mirrors: { ...base.mirrors, maven: 'https://maven.example.com' } })
    const patch = diffSettings(base, next)
    expect(Object.keys(patch)).toEqual(['mirrors'])
    expect(patch.mirrors?.maven).toBe('https://maven.example.com')
  })

  it('ignores key order inside nested objects', () => {
    const base = settings()
    const reordered = {
      ...base,
      mirrors: {
        curseforge: base.mirrors.curseforge,
        modrinth: base.mirrors.modrinth,
        quilt: base.mirrors.quilt,
        neoforge: base.mirrors.neoforge,
        forge: base.mirrors.forge,
        fabric: base.mirrors.fabric,
        maven: base.mirrors.maven,
        assets: base.mirrors.assets,
        launcherMeta: base.mirrors.launcherMeta,
        versionManifest: base.mirrors.versionManifest,
      },
    }
    expect(diffSettings(base, reordered)).toEqual({})
  })

  it('treats undefined dataDir and null dataDir as a change', () => {
    const patch = diffSettings(settings({ dataDir: null }), settings({ dataDir: 'D:/mc' }))
    expect(patch.dataDir).toBe('D:/mc')
  })
})

describe('stableStringify', () => {
  it('sorts keys recursively', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, 1] } })).toBe('{"a":{"c":[3,1],"d":2},"b":1}')
    expect(stableStringify(null)).toBe('null')
    expect(stableStringify([1, 2])).toBe('[1,2]')
  })
})

describe('clampInt', () => {
  it('clamps into the inclusive range and rounds', () => {
    expect(clampInt('0', LIMITS.concurrency.min, LIMITS.concurrency.max)).toBe(1)
    expect(clampInt('999', 1, 64)).toBe(64)
    expect(clampInt('4.6', 1, 64)).toBe(5)
    expect(clampInt('abc', 1, 64)).toBeNull()
    expect(clampInt('', 1, 64)).toBeNull()
    expect(clampInt('   ', 1, 64)).toBeNull()
  })
})

describe('maskSecret', () => {
  it('keeps the first and last characters visible', () => {
    expect(maskSecret(undefined)).toBe('')
    expect(maskSecret('short')).toBe('•••••')
    expect(maskSecret('$2a$10$abcdefghijklmnop')).toMatch(/^\$2a\$•+mnop$/)
  })
})

describe('cloneSettings', () => {
  it('produces a deep copy', () => {
    const base = settings()
    const copy = cloneSettings(base)
    copy.mirrors.maven = 'https://changed'
    expect(base.mirrors.maven).toBe('https://libraries.minecraft.net')
    expect(copy).not.toBe(base)
  })
})
