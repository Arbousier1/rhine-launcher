import { describe, expect, it } from 'vitest'
import type { Account, Instance, JavaRuntime, Settings } from '@rhine/core'
import originalDefaults from '../data/original-defaults.json'
import * as projections from '../src/compat/projections.ts'

const { toOriginalInstance, toOriginalUser, toOriginalJava, toOriginalSettings } = projections

function instance(patch: Partial<Instance> = {}): Instance {
  return {
    id: 'local-pack-id', path: 'E:\\RhineData\\instances\\pack', name: 'Rhine Pack',
    gameVersion: '1.21.4', loaders: [], revision: 1_730_000_000_999,
    createdAt: 1_700_000_000_001, lastLaunchedAt: 1_720_000_000_002, playTimeMs: 3_600_125,
    javaPath: 'C:\\Java\\bin\\java.exe', memory: { minMb: 512, maxMb: 4096 },
    jvmArgs: ['-Dfile.encoding=UTF-8'], gameArgs: ['--demo'],
    window: { width: 1280, height: 720, fullscreen: false },
    notes: 'Actual instance notes', icon: 'icon.png', ...patch,
  }
}
function account(patch: Partial<Account> = {}): Account {
  return { id: 'local-account-id', kind: 'offline', name: 'RhinePlayer',
    uuid: '00112233-4455-6677-8899-AABBCCDDEEFF', ...patch }
}
function settings(patch: Partial<Settings> = {}): Settings {
  return {
    language: 'en-US', dataDir: 'E:/RhineData', concurrency: 7,
    mirrors: {
      versionManifest: 'https://meta.example/mc/game/version_manifest_v2.json',
      launcherMeta: 'https://meta.example', assets: 'https://assets.example', maven: 'https://maven.example',
      fabric: 'https://fabric.example', forge: 'https://forge.example', neoforge: 'https://neoforge.example',
      quilt: 'https://quilt.example', modrinth: 'https://modrinth.example', curseforge: 'https://curseforge.example',
    },
    proxy: { enabled: true, host: '127.0.0.1', port: 8123 },
    autoDownloadJava: true, keepLogs: 23, showSnapshots: true, downloadSource: 'official', theme: 'light',
    ...patch,
  }
}

describe('original entity DTO projections', () => {
  it('exports exactly the four pure projection functions', () => {
    expect(Object.keys(projections).sort()).toEqual([
      'toOriginalInstance', 'toOriginalJava', 'toOriginalSettings', 'toOriginalUser',
    ])
  })

  describe('toOriginalInstance', () => {
    it('maps canonical path, runtime requirements, launch options and millisecond dates/playtime', () => {
      const dto = instance({ loaders: [
        { kind: 'forge', version: '54.0.12' }, { kind: 'fabric', version: '0.16.10' },
        { kind: 'quilt', version: '0.28.0' }, { kind: 'neoforge', version: '21.4.86' },
        { kind: 'optifine', version: 'HD_U_J3' },
      ] })
      expect(toOriginalInstance(dto)).toEqual({
        path: dto.path, name: dto.name, author: '', description: dto.notes, version: '', edition: 'java',
        runtime: { minecraft: '1.21.4', forge: '54.0.12', fabricLoader: '0.16.10', quiltLoader: '0.28.0',
          neoForged: '21.4.86', optifine: 'HD_U_J3', labyMod: '' },
        java: dto.javaPath, resolution: dto.window, minMemory: 512, maxMemory: 4096, assignMemory: true,
        vmOptions: dto.jvmArgs, mcOptions: dto.gameArgs, url: '', icon: 'icon.png', fileApi: '', server: null,
        creationDate: dto.createdAt, lastAccessDate: 0, lastPlayedDate: dto.lastLaunchedAt, playtime: dto.playTimeMs,
      })
    })

    it.each(['E:\\RhineData\\instances\\pack', '\\\\nas\\games\\instances\\pack', '/var/lib/rhine/instances/pack'])(
      'preserves backend path %s instead of replacing it with a local id', path => {
        expect(toOriginalInstance(instance({ path })).path).toBe(path)
      },
    )

    it('does not manufacture installed versions or unsupported loader requirements', () => {
      const result = toOriginalInstance(instance({ loaders: [
        { kind: 'vanilla' }, { kind: 'liteloader', version: '1.12.2' }, { kind: 'fabric' },
      ] }))
      expect(result.version).toBe('')
      expect(result.runtime).toEqual({ minecraft: '1.21.4', forge: '', fabricLoader: '', quiltLoader: '',
        neoForged: '', optifine: '', labyMod: '' })
      expect(result).not.toHaveProperty('installed')
      expect(result).not.toHaveProperty('libraries')
      expect(result.runtime).not.toHaveProperty('liteloader')
      expect(result.server).toBeNull()
    })

    it('keeps unknown optional fields absent and never relabels config revision as access history', () => {
      const result = toOriginalInstance(instance({ createdAt: 0, lastLaunchedAt: undefined, playTimeMs: 0,
        javaPath: undefined, icon: undefined, notes: undefined }))
      expect(result).toMatchObject({ creationDate: 0, lastPlayedDate: 0, lastAccessDate: 0, playtime: 0, icon: '', description: '' })
      expect(result.java).toBeUndefined()
      expect(toOriginalInstance(instance({ lastLaunchedAt: 0 })).lastPlayedDate).toBe(0)
    })

    it('is deterministic, does not mutate a frozen DTO and detaches launch option containers', () => {
      const dto = instance()
      const before = structuredClone(dto)
      Object.freeze(dto); Object.freeze(dto.jvmArgs); Object.freeze(dto.gameArgs); Object.freeze(dto.window)
      const first = toOriginalInstance(dto), second = toOriginalInstance(dto)
      expect(first).toEqual(second)
      first.vmOptions.push('-Dchanged=true'); first.mcOptions.push('--changed'); first.resolution.width = 640
      first.runtime.minecraft = 'changed'
      expect(dto).toEqual(before)
      expect(second.vmOptions).toEqual(before.jvmArgs)
      expect(second.runtime.minecraft).toBe('1.21.4')
    })
  })

  describe('toOriginalUser', () => {
    const authorities: { kind: Account['kind']; authority: string; authServerUrl?: string }[] = [
      { kind: 'offline', authority: 'x://dev' },
      { kind: 'microsoft', authority: 'x://microsoft' },
      { kind: 'authlib-injector', authServerUrl: 'https://auth.example/api/yggdrasil', authority: 'https://auth.example/api/yggdrasil' },
    ]
    it.each(authorities)('keeps $kind auth service and actual original authority truthful', ({ kind, authority, authServerUrl }) => {
      const result = toOriginalUser(account({ kind, authServerUrl, expiresAt: 1_740_000_000_003 }))
      expect(result).toMatchObject({ id: 'local-account-id', username: 'RhinePlayer', authService: kind, authority,
        invalidated: false, expiredAt: 1_740_000_000_003, selectedProfile: '00112233445566778899aabbccddeeff' })
      expect(Object.keys(result.profiles)).toEqual([result.selectedProfile])
      expect(result.profiles[result.selectedProfile]).toMatchObject({ id: result.selectedProfile, name: 'RhinePlayer' })
    })

    it.each(['00112233-4455-6677-8899-AABBCCDDEEFF', '00112233445566778899AABBCCDDEEFF'])(
      'projects UUID %s consistently into the selected profile and dictionary key', uuid => {
        const result = toOriginalUser(account({ uuid }))
        expect(result.selectedProfile).toBe('00112233445566778899aabbccddeeff')
        expect(result.profiles[result.selectedProfile].id).toBe(result.selectedProfile)
        expect(result.selectedProfile).not.toBe(result.id)
      },
    )

    it('never emits credential fields, even when a private DTO contains real credentials', () => {
      const safe = account({ kind: 'microsoft', expiresAt: 1_740_000_000_003 })
      const privateDto = { ...safe, accessToken: 'actual-access-secret', refreshToken: 'actual-refresh-secret', clientToken: 'actual-client-secret' }
      const result = toOriginalUser(privateDto)
      expect(result).toEqual(toOriginalUser(safe))
      for (const field of ['accessToken', 'refreshToken', 'clientToken', 'microsoftClientId', 'homeAccountId']) {
        expect(result).not.toHaveProperty(field)
      }
      expect(JSON.stringify(result)).not.toContain('secret')
      expect(toOriginalUser(safe).invalidated).toBe(false)
    })

    it('preserves actual online expiry and does not invent it from token presence', () => {
      expect(toOriginalUser(account({ kind: 'microsoft', expiresAt: 0 })).expiredAt).toBe(0)
      expect(toOriginalUser(account({ kind: 'microsoft', accessToken: 'real-token' })).expiredAt).toBe(-1)
      expect(toOriginalUser(account({ kind: 'authlib-injector', authServerUrl: 'https://auth.example' })).expiredAt).toBe(-1)
      const offline = toOriginalUser(account())
      expect(offline.expiredAt).toBe(Number.MAX_SAFE_INTEGER)
      expect(JSON.parse(JSON.stringify(offline)).expiredAt).toBe(Number.MAX_SAFE_INTEGER)
    })

    it('does not substitute another auth service when the custom authority is missing', () => {
      expect(toOriginalUser(account({ kind: 'authlib-injector' }))).toMatchObject({
        authService: 'authlib-injector', authority: '', invalidated: true, expiredAt: -1,
      })
    })

    it.each([{ skinModel: 'slim' as const, model: 'slim' }, { skinModel: 'classic' as const, model: 'steve' }])(
      'maps known $skinModel metadata without claiming an avatar is a skin or enabling upload', ({ skinModel, model }) => {
        const dto = account({ skinModel, avatar: 'https://images.example/face.png' })
        Object.freeze(dto)
        const result = toOriginalUser(dto), profile = result.profiles[result.selectedProfile]
        expect(result.avatar).toBe(dto.avatar)
        expect(profile.textures.SKIN).toEqual({ url: '', metadata: { model } })
        for (const field of ['uploadable', 'skins', 'capes', 'paid', 'migrated']) expect(profile).not.toHaveProperty(field)
        profile.textures.SKIN.url = 'changed'
        expect(toOriginalUser(dto).profiles[result.selectedProfile].textures.SKIN.url).toBe('')
      },
    )

    it('leaves unknown texture metadata absent', () => {
      const result = toOriginalUser(account())
      expect(result.profiles[result.selectedProfile].textures).toEqual({ SKIN: { url: '' } })
    })
  })

  describe('toOriginalJava', () => {
    const java: JavaRuntime = { path: 'C:\\Java\\bin\\java.exe', version: '21.0.5+11', majorVersion: 21,
      vendor: 'Eclipse Adoptium', arch: 'x64', managed: true }
    it('includes the original JavaRecord fields without inventing probe validity', () => {
      expect(toOriginalJava(java)).toEqual({ path: java.path, version: java.version, majorVersion: 21, arch: 'x64', valid: false })
      expect(toOriginalJava({ ...java, managed: false })).toEqual(toOriginalJava(java))
    })
    it.each([true, false])('copies explicitly known probe validity %s without IO or mutating the DTO', valid => {
      const before = structuredClone(java)
      Object.freeze(java)
      expect(toOriginalJava(java, valid).valid).toBe(valid)
      expect(java).toEqual(before)
    })
    it('retains unknown architecture/version as unknown rather than creating a usable JRE', () => {
      expect(toOriginalJava({ ...java, version: '', majorVersion: 0, arch: 'unknown' })).toMatchObject({
        version: '', majorVersion: 0, arch: 'unknown', valid: false,
      })
    })
  })

  describe('toOriginalSettings', () => {
    it('overlays actual shared settings and explicit readiness on real caller-supplied original defaults', () => {
      const result = toOriginalSettings(settings(), originalDefaults.Settings, { databaseReady: true, online: true })
      expect(result).toEqual({ ...originalDefaults.Settings, locale: 'en-US', theme: 'light', apiSetsPreference: 'mojang',
        maxSockets: 7, httpProxy: 'http://127.0.0.1:8123', httpProxyEnabled: true, databaseReady: true, online: true })
      // These are different capabilities, not aliases for snapshots/Java install.
      expect(result.allowPrerelease).toBe(false); expect(result.autoDownload).toBe(false)
      expect(result.updateStatus).toBe('none'); expect(result.maxAPISockets).toBe(0)
      expect(result).not.toHaveProperty('dataDir'); expect(result).not.toHaveProperty('autoDownloadJava')
    })

    it.each([{ theme: 'ellan' as const, original: 'dark' }, { theme: 'archive' as const, original: 'dark' },
      { theme: 'midnight' as const, original: 'dark' }, { theme: 'light' as const, original: 'light' }])(
      'maps Rhine $theme to a supported original $original theme', ({ theme, original }) => {
        expect(toOriginalSettings(settings({ theme }), originalDefaults.Settings, { databaseReady: false }).theme).toBe(original)
      },
    )

    it('honors false readiness and does not infer online status from settings or a successful projection', () => {
      const defaults = { ...originalDefaults.Settings, databaseReady: true, online: true }
      expect(toOriginalSettings(settings(), defaults, { databaseReady: false, online: false })).toMatchObject({ databaseReady: false, online: false })
      expect(toOriginalSettings(settings(), defaults, { databaseReady: false }).online).toBe(true)
      expect(toOriginalSettings(settings(), originalDefaults.Settings, { databaseReady: true }).online).toBe(false)
    })

    it('uses supplied defaults for unsupported fields and detaches nested defaults without mutating any input', () => {
      const defaults = { ...structuredClone(originalDefaults.Settings), globalMinMemory: 123, globalVmOptions: ['-Doriginal=true'],
        globalEnv: { ORIGINAL: 'value' }, extraOriginalField: { supportedByOriginal: false } }
      const dto = settings(), before = structuredClone(defaults), dtoBefore = structuredClone(dto)
      Object.freeze(defaults); Object.freeze(defaults.apiSets); Object.freeze(dto); Object.freeze(dto.proxy)
      const result = toOriginalSettings(dto, defaults, { databaseReady: false })
      expect(result.globalMinMemory).toBe(123)
      expect(result.extraOriginalField).toEqual(before.extraOriginalField)
      result.globalVmOptions.push('changed'); result.globalEnv.ORIGINAL = 'changed'; result.apiSets[0].url = 'changed'
      result.extraOriginalField.supportedByOriginal = true
      expect(defaults).toEqual(before); expect(dto).toEqual(dtoBefore)
      expect(toOriginalSettings(dto, defaults, { databaseReady: false }).globalVmOptions).toEqual(['-Doriginal=true'])
    })

    it('recognizes only the actually configured named BMCL root and does not fabricate custom mirror families', () => {
      const dto = settings({ downloadSource: 'mirror' })
      dto.mirrors.launcherMeta = originalDefaults.Settings.apiSets[0].url + '/'
      const bmcl = toOriginalSettings(dto, originalDefaults.Settings, { databaseReady: true })
      expect(bmcl.apiSetsPreference).toBe('bmcl')
      expect(bmcl.apiSets).toEqual(originalDefaults.Settings.apiSets)
      dto.mirrors.launcherMeta = 'https://custom.example/metadata'
      const custom = toOriginalSettings(dto, originalDefaults.Settings, { databaseReady: true })
      expect(custom.apiSetsPreference).toBe('')
      expect(custom.apiSets).toEqual(originalDefaults.Settings.apiSets)
      expect(custom).not.toHaveProperty('mirrors')
    })

    it.each(['::1', '[::1]'])('formats actual IPv6 proxy host %s without exposing credentials', host => {
      const result = toOriginalSettings(settings({ proxy: { enabled: true, host, port: 9000, username: 'proxy-user', password: 'proxy-secret' } }),
        originalDefaults.Settings, { databaseReady: false })
      expect(result.httpProxy).toBe('http://[::1]:9000')
      expect(JSON.stringify(result)).not.toContain('proxy-secret')
      expect(JSON.stringify(result)).not.toContain('proxy-user')
    })

    it('clears stale original proxy defaults when the actual DTO has no proxy', () => {
      const defaults = { ...originalDefaults.Settings, httpProxy: 'http://stale.example:9999', httpProxyEnabled: true }
      expect(toOriginalSettings(settings({ proxy: undefined }), defaults, { databaseReady: false })).toMatchObject({ httpProxy: '', httpProxyEnabled: false })
      expect(toOriginalSettings(settings({ proxy: { enabled: false, host: 'localhost', port: 8123 } }), defaults,
        { databaseReady: false })).toMatchObject({ httpProxy: 'http://localhost:8123', httpProxyEnabled: false })
    })
  })
})
