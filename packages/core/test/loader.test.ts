import { afterEach, describe, expect, it } from 'vitest'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHash } from 'node:crypto'
import { crc32, deflateRawSync } from 'node:zlib'
import type { RhPaths, DownloadOptions } from '../src/contracts.ts'
import type { JavaRuntime } from '../src/types.ts'
import type { LoaderHost } from '../src/loader/capabilities.ts'
import {
  fabricProfileUrls, fabricVersionId, fabricVersionsUrls, classifyFabricVersion,
  fabricVersionFromId, normalizeFabricProfile, parseFabricVersions,
} from '../src/loader/fabric.ts'
import {
  classifyQuiltVersion, normalizeQuiltProfile, parseQuiltVersions, quiltProfileUrls,
  quiltVersionId, quiltVersionsUrls,
} from '../src/loader/quilt.ts'
import {
  classifyForgeVersion, forgeInstallerPath, forgeInstallerUrls, forgeMetadataUrls,
  forgeVersionFromId, forgeVersionId, parseForgeArtefactVersion, parseForgeVersions,
} from '../src/loader/forge.ts'
import {
  classifyNeoForgeVersion, findNeoForgeIndexEntry, neoforgeInstallerPath,
  neoforgeInstallerUrls, neoforgeMetadataUrls, neoforgeVersionId, neoforgeVersionFromId,
  parseNeoForgeIndex, parseNeoForgeMavenVersions,
} from '../src/loader/neoforge.ts'
import {
  OPTIFINE_MAIN_CLASS, OPTIFINE_TWEAK_CLASS, buildOptiFineVersionJson, optifineFilename,
  optifineInstallerUrls, optifineLibraryPath, optifineVersionId, optifineVersionFromId,
  optifineVersions, parseOptiFineEntries, splitOptiFineVersion,
} from '../src/loader/optifine.ts'
import {
  artifactUrls, collectInstallerArtifacts, coordinateUrls, mavenPath, mirrorMavenUrl,
  parseMavenCoordinate, processorCoordinates,
} from '../src/loader/maven.ts'
import {
  downloadVerified, fetchChecksums, fetchText, httpsCandidates, isHttpsUrl,
} from '../src/loader/http.ts'
import {
  installWithInstaller, validateGeneratedVersion, validateInstallerPackage,
} from '../src/loader/installer.ts'
import { installOptiFineDetailed } from '../src/loader/optifine-install.ts'
import { installProfileVersion } from '../src/loader/profile-install.ts'
import {
  detectLoaderAttachments, ensureLauncherProfiles, readInstalledVersions, readVersionJson,
  versionJsonExists, writeVersionJson,
} from '../src/loader/versions.ts'
import { loaderJavaMajor, requiredJavaMajor } from '../src/loader/runtime.ts'
import { LoaderService, LOADER_ADAPTERS } from '../src/services/loader.ts'

function makeZip(entries: { name: string; content: string | Buffer }[]): Buffer {
  const locals: Buffer[] = []
  const centrals: Buffer[] = []
  let offset = 0
  for (const entry of entries) {
    const name = Buffer.from(entry.name, 'utf8')
    const data = Buffer.isBuffer(entry.content) ? entry.content : Buffer.from(entry.content, 'utf8')
    const compressed = deflateRawSync(data)
    const crc = crc32(data) >>> 0
    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(data.length, 22)
    local.writeUInt16LE(name.length, 26)
    locals.push(local, name, compressed)
    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(data.length, 24)
    central.writeUInt16LE(name.length, 28)
    central.writeUInt32LE(offset, 42)
    centrals.push(central, name)
    offset += 30 + name.length + compressed.length
  }
  const directory = Buffer.concat(centrals)
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(entries.length, 8)
  eocd.writeUInt16LE(entries.length, 10)
  eocd.writeUInt32LE(directory.length, 12)
  eocd.writeUInt32LE(offset, 16)
  return Buffer.concat([...locals, directory, eocd])
}

function sha1Of(data: Buffer): string {
  return createHash('sha1').update(data).digest('hex')
}

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

function javaRuntime(version = '17.0.15', majorVersion = 17): JavaRuntime {
  return { path: 'C:/fake-jdk/bin/java.exe', version, majorVersion, vendor: 'Test', arch: 'x64', managed: false }
}

interface HostOverrides {
  text?: (url: string) => Promise<string>
  file?: (options: DownloadOptions) => Promise<number>
  installed?: () => Promise<string[]>
  verify?: (id: string) => Promise<boolean>
  installVersion?: (game: string) => Promise<void>
  java?: JavaRuntime[]
}

function makeHost(root: string, overrides: HostOverrides = {}): LoaderHost {
  const paths = pathsOf(root)
  const runtimes = overrides.java ?? [javaRuntime()]
  return {
    signal: new AbortController().signal,
    task: undefined,
    paths: () => paths,
    text: overrides.text ?? (async (url) => { throw new Error('unexpected text request: ' + url) }),
    file: overrides.file ?? (async () => { throw new Error('unexpected file download') }),
    verifyVersion: overrides.verify ?? (async (id) => versionJsonExists(paths.versions, id)),
    installedVersions: overrides.installed ?? (async () => {
      const versions = await readInstalledVersions(paths.versions)
      return versions.map((version) => version.id)
    }),
    installVersion: overrides.installVersion ?? (async (game) => {
      await mkdir(join(paths.versions, game), { recursive: true })
      await writeFile(join(paths.versions, game, game + '.json'), JSON.stringify({ id: game }))
    }),
    pickJava: (majorVersion) => runtimes.find((runtime) => runtime.majorVersion >= majorVersion) ?? runtimes[0],
    scanJava: async () => runtimes,
    log: () => undefined,
  }
}

describe('fabric protocol', () => {
  it('builds official and BMCLAPI urls', () => {
    expect(fabricVersionsUrls('1.20.1')).toEqual([
      'https://meta.fabricmc.net/v2/versions/loader/1.20.1',
      'https://bmclapi2.bangbang93.com/fabric-meta/v2/versions/loader/1.20.1',
    ])
    expect(fabricProfileUrls('1.20.1', '0.16.9')[0])
      .toBe('https://meta.fabricmc.net/v2/versions/loader/1.20.1/0.16.9/profile/json')
  })

  it('parses loader entries and normalises profiles', () => {
    const parsed = parseFabricVersions([
      { loader: { version: '0.16.9', stable: true } },
      { loader: { version: '0.17.0-beta.1', stable: false } },
    ], '1.20.1')
    expect(parsed.map((item) => item.version)).toEqual(['0.16.9', '0.17.0-beta.1'])
    expect(parsed[1].stable).toBe(false)
    expect(fabricVersionId('1.20.1', '0.16.9')).toBe('fabric-loader-0.16.9-1.20.1')
    const normalized = normalizeFabricProfile({
      inheritsFrom: '1.20.1',
      mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
      libraries: [{ name: 'net.fabricmc:intermediary:1.20.1' }],
    }, '1.20.1', '0.16.9')
    expect(normalized.id).toBe('fabric-loader-0.16.9-1.20.1')
    expect(normalized.inheritsFrom).toBe('1.20.1')
    expect(() => normalizeFabricProfile({ inheritsFrom: '1.20.1' }, '1.20.1', '0.16.9')).toThrow(/mainClass/)
  })

  it('classifies installed fabric versions', () => {
    expect(fabricVersionFromId('fabric-loader-0.16.9-1.20.1', '1.20.1')).toBe('0.16.9')
    expect(classifyFabricVersion({ inheritsFrom: '1.20.1' }, 'fabric-loader-0.16.9-1.20.1'))
      .toEqual({ version: '0.16.9' })
    expect(classifyFabricVersion({}, '1.20.1')).toBeUndefined()
  })
})

describe('quilt protocol', () => {
  it('builds urls and normalises profiles', () => {
    expect(quiltVersionsUrls('1.20.1')[0]).toBe('https://meta.quiltmc.org/v3/versions/loader/1.20.1')
    expect(quiltProfileUrls('1.20.1', '0.24.0')[0])
      .toBe('https://meta.quiltmc.org/v3/versions/loader/1.20.1/0.24.0/profile/json')
    expect(quiltVersionId('1.20.1', '0.24.0')).toBe('quilt-loader-0.24.0-1.20.1')
    expect(parseQuiltVersions([{ loader: { version: '0.24.0', stable: true } }], '1.20.1')[0])
      .toMatchObject({ version: '0.24.0', type: 'release' })
    expect(normalizeQuiltProfile({ mainClass: 'org.quiltmc.loader.impl.launch.knot.KnotClient' }, '1.20.1', '0.24.0').id)
      .toBe('quilt-loader-0.24.0-1.20.1')
    expect(classifyQuiltVersion({ inheritsFrom: '1.20.1' }, 'quilt-loader-0.24.0-1.20.1')).toEqual({ version: '0.24.0' })
  })
})

describe('forge protocol', () => {
  const xml = [
    '<metadata><versioning><versions>',
    '<version>1.16.5-36.2.39</version>',
    '<version>1.20.1-47.2.0</version>',
    '<version>1.20.1-47.3.0</version>',
    '<version>1.20.2-48.0.0</version>',
    '</versions></versioning></metadata>',
  ].join('')

  it('builds metadata and installer urls', () => {
    expect(forgeMetadataUrls()).toEqual([
      'https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml',
      'https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/maven-metadata.xml',
    ])
    expect(forgeInstallerPath('1.20.1', '47.4.28'))
      .toBe('net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-installer.jar')
    const urls = forgeInstallerUrls('1.20.1', '47.4.28')
    expect(urls[0]).toBe('https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-installer.jar')
    expect(urls[1]).toBe('https://bmclapi2.bangbang93.com/maven/net/minecraftforge/forge/1.20.1-47.4.28/forge-1.20.1-47.4.28-installer.jar')
    expect(forgeVersionId('1.20.1', '47.4.28')).toBe('1.20.1-forge-47.4.28')
  })

  it('filters maven metadata newest-first including the calendar scheme', () => {
    expect(parseForgeVersions(xml, '1.20.1').map((item) => item.version)).toEqual(['47.3.0', '47.2.0'])
    expect(parseForgeVersions('<version>26.3-66.0.13</version><version>26.3-66.1.0</version>', '26.3').map((item) => item.version))
      .toEqual(['66.1.0', '66.0.13'])
    expect(parseForgeArtefactVersion('26.3-66.1.0')).toEqual({ gameVersion: '26.3', loaderVersion: '66.1.0' })
  })

  it('classifies forge without stealing NeoForge 1.20.1', () => {
    expect(forgeVersionFromId('1.20.1-forge-47.4.28', '1.20.1')).toBe('47.4.28')
    expect(classifyForgeVersion({ libraries: [{ name: 'net.minecraftforge:forge:1.20.1-47.4.28' }] }, '1.20.1-forge-47.4.28'))
      .toEqual({ version: '47.4.28' })
    expect(classifyForgeVersion({ libraries: [{ name: 'net.neoforged.fancymodloader:loader:47.2.2' }] }, '1.20.1-forge-47.1.106'))
      .toBeUndefined()
  })
})

describe('neoforge protocol', () => {
  const index = {
    versions: [
      { version: '47.1.106', releaseTime: '2024-05-28T17:38:31+00:00', requires: [{ uid: 'net.minecraft', equals: '1.20.1' }], sha256: 'abc' },
      { version: '47.1.105', releaseTime: '2024-05-27T17:38:31+00:00', requires: [{ uid: 'net.minecraft', equals: '1.20.1' }] },
      { version: '20.4.237', releaseTime: '2024-02-01T00:00:00+00:00', requires: [{ uid: 'net.minecraft', equals: '1.20.4' }] },
      { version: '21.1.209', releaseTime: '2025-09-15T00:00:00+00:00', requires: [{ uid: 'net.minecraft', equals: '1.21.1' }] },
      { version: '21.1.210', requires: [{ uid: 'net.minecraft', equals: '1.21.1' }] },
      { version: '99.0.0', requires: [{ uid: 'net.minecraft', range: '>=1.21' }] },
    ],
  }

  it('uses explicit requires from the MultiMC index', () => {
    const versions = parseNeoForgeIndex(index, '1.20.1')
    expect(versions.map((item) => item.version)).toEqual(['47.1.106', '47.1.105'])
    expect(versions[0].stable).toBe(true)
    expect(findNeoForgeIndexEntry(index, '1.20.1', '47.1.106')?.sha256).toBe('abc')
    expect(parseNeoForgeIndex(index, '1.21.1').map((item) => item.version)).toEqual(['21.1.209', '21.1.210'])
    expect(parseNeoForgeIndex(index, '1.20.1').some((item) => item.version === '99.0.0')).toBe(false)
  })

  it('falls back to maven metadata with documented coordinates', () => {
    expect(parseNeoForgeMavenVersions(
      '<version>1.20.1-47.1.105</version><version>1.20.1-47.1.106</version><version>1.20.2-48.0.0</version>',
      '1.20.1',
    ).map((item) => item.version)).toEqual(['47.1.106', '47.1.105'])
    expect(parseNeoForgeMavenVersions('<version>21.1.208</version><version>21.1.209</version><version>20.4.237</version>', '1.21.1')
      .map((item) => item.version)).toEqual(['21.1.209', '21.1.208'])
    expect(parseNeoForgeMavenVersions('<version>26.3.0.97</version>', '26.3').map((item) => item.version)).toEqual(['26.3.0.97'])
  })

  it('builds the 1.20.1 vs modern coordinates and urls', () => {
    expect(neoforgeInstallerPath('1.20.1', '47.1.106'))
      .toBe('net/neoforged/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar')
    expect(neoforgeInstallerUrls('1.20.1', '47.1.106')[0])
      .toBe('https://maven.neoforged.net/releases/net/neoforged/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar')
    expect(neoforgeInstallerUrls('1.20.1', '47.1.106')[1])
      .toBe('https://bmclapi2.bangbang93.com/maven/net/neoforged/forge/1.20.1-47.1.106/forge-1.20.1-47.1.106-installer.jar')
    expect(neoforgeInstallerPath('1.21.1', '21.1.209'))
      .toBe('net/neoforged/neoforge/21.1.209/neoforge-21.1.209-installer.jar')
    expect(neoforgeVersionId('1.20.1', '47.1.106')).toBe('1.20.1-forge-47.1.106')
    expect(neoforgeVersionId('1.21.1', '21.1.209')).toBe('neoforge-21.1.209')
    expect(neoforgeMetadataUrls('1.20.1')[0]).toContain('net/neoforged/forge/maven-metadata.xml')
    expect(neoforgeMetadataUrls('1.21.1')[0]).toContain('net/neoforged/neoforge/maven-metadata.xml')
  })

  it('classifies NeoForge 1.20.1 as neoforge, not forge', () => {
    const json = { libraries: [{ name: 'net.neoforged.fancymodloader:loader:47.2.2' }] }
    expect(classifyNeoForgeVersion(json, '1.20.1-forge-47.1.106')).toEqual({ version: '47.1.106' })
    expect(neoforgeVersionFromId('neoforge-21.1.209')).toBe('21.1.209')
  })
})

describe('optifine protocol', () => {
  const entries = [
    { mcversion: '1.20.1', patch: 'I5', type: 'HD_U', filename: 'OptiFine_1.20.1_HD_U_I5.jar', forge: 'Forge 47.0.35' },
    { mcversion: '1.20.1', patch: 'I6', type: 'HD_U', filename: 'OptiFine_1.20.1_HD_U_I6.jar', forge: 'Forge 47.2.18' },
    { mcversion: '1.20.1', patch: 'pre4', type: 'HD_U_I5', filename: 'preview_OptiFine_1.20.1_HD_U_I5_pre4.jar' },
  ]

  it('parses stable builds before previews', () => {
    const builds = parseOptiFineEntries(entries, '1.20.1')
    expect(builds.map((build) => build.loaderVersion)).toEqual(['HD_U_I6', 'HD_U_I5', 'HD_U_I5_pre4'])
    expect(builds[2].preview).toBe(true)
    const versions = optifineVersions(entries, '1.20.1')
    expect(versions[0]).toMatchObject({ version: 'HD_U_I6', type: 'release', stable: true })
    expect(versions[2]).toMatchObject({ version: 'HD_U_I5_pre4', type: 'snapshot', stable: false })
  })

  it('rebuilds type/patch/filename and installer urls', () => {
    expect(splitOptiFineVersion('HD_U_I5_pre4')).toEqual({ type: 'HD_U_I5', patch: 'pre4' })
    expect(splitOptiFineVersion('HD_U_I6')).toEqual({ type: 'HD_U', patch: 'I6' })
    expect(splitOptiFineVersion('HD_U')).toBeUndefined()
    expect(optifineFilename('HD_U_I5', 'pre4', '1.20.1')).toBe('preview_OptiFine_1.20.1_HD_U_I5_pre4.jar')
    expect(optifineFilename('HD_U', 'I6', '1.20.1')).toBe('OptiFine_1.20.1_HD_U_I6.jar')
    expect(optifineInstallerUrls('1.20.1', 'HD_U_I5_pre4')[0])
      .toBe('https://bmclapi2.bangbang93.com/optifine/1.20.1/HD_U_I5/pre4')
    expect(optifineInstallerUrls('1.20.1', 'HD_U_I5_pre4')[1])
      .toBe('https://bmclapi2.bangbang93.com/maven/com/optifine/1.20.1/preview_OptiFine_1.20.1_HD_U_I5_pre4.jar')
    expect(optifineVersionId('1.20.1', 'HD_U_I5_pre4')).toBe('1.20.1-OptiFine_HD_U_I5_pre4')
    expect(optifineVersionFromId('1.20.1-OptiFine_HD_U_I5_pre4')).toBe('HD_U_I5_pre4')
  })

  it('builds the launchwrapper/tweak version json', () => {
    const json = buildOptiFineVersionJson({
      gameVersion: '1.20.1',
      loaderVersion: 'HD_U_I5_pre4',
      optifine: { path: optifineLibraryPath('1.20.1', 'HD_U_I5_pre4'), sha1: 'a'.repeat(40), size: 10 },
      launchwrapper: { version: '2.3', path: 'optifine/launchwrapper-of/2.3/launchwrapper-of-2.3.jar', sha1: 'b'.repeat(40), size: 20 },
    })
    expect(json.id).toBe('1.20.1-OptiFine_HD_U_I5_pre4')
    expect(json.inheritsFrom).toBe('1.20.1')
    expect(json.mainClass).toBe(OPTIFINE_MAIN_CLASS)
    expect((json.arguments as { game: string[] }).game).toEqual(['--tweakClass', OPTIFINE_TWEAK_CLASS])
    const libraries = json.libraries as { name: string; downloads: { artifact: { path: string } } }[]
    expect(libraries[0].name).toBe('optifine:OptiFine:1.20.1_HD_U_I5_pre4')
    expect(libraries[1].name).toBe('optifine:launchwrapper-of:2.3')
  })
})

describe('java requirements', () => {
  it('maps game versions to the installer JVM', () => {
    expect(requiredJavaMajor('1.16.5')).toBe(8)
    expect(requiredJavaMajor('1.17.1')).toBe(16)
    expect(requiredJavaMajor('1.20.1')).toBe(17)
    expect(requiredJavaMajor('1.20.6')).toBe(21)
    expect(requiredJavaMajor('1.21.1')).toBe(21)
    expect(requiredJavaMajor('26.3')).toBe(21)
    expect(loaderJavaMajor('forge', '1.20.1')).toBe(17)
    expect(loaderJavaMajor('neoforge', '1.21.1')).toBe(21)
    expect(loaderJavaMajor('optifine', '1.20.1')).toBe(17)
    expect(loaderJavaMajor('fabric', '1.20.1')).toBe(8)
  })
})

/* ------------------------------------------------------------------ */
/* maven / https downloads                                             */
/* ------------------------------------------------------------------ */

describe('maven coordinates and installer plans', () => {
  it('parses coordinates, paths and mirrors', () => {
    const coordinate = parseMavenCoordinate('de.oceanlabs.mcp:mcp_config:1.20.1-20230612.114412:mappings@txt')
    expect(coordinate).toEqual({
      group: 'de.oceanlabs.mcp',
      artifact: 'mcp_config',
      version: '1.20.1-20230612.114412',
      classifier: 'mappings',
      extension: 'txt',
    })
    expect(mavenPath(coordinate!)).toBe('de/oceanlabs/mcp/mcp_config/1.20.1-20230612.114412/mcp_config-1.20.1-20230612.114412-mappings.txt')
    expect(parseMavenCoordinate('bad')).toBeUndefined()
    expect(mirrorMavenUrl('https://maven.neoforged.net/releases/net/neoforged/forge/x/y.jar'))
      .toBe('https://bmclapi2.bangbang93.com/maven/net/neoforged/forge/x/y.jar')
    expect(mirrorMavenUrl('https://maven.minecraftforge.net/a/b.jar'))
      .toBe('https://bmclapi2.bangbang93.com/maven/a/b.jar')
    expect(mirrorMavenUrl('http://maven.minecraftforge.net/a/b.jar')).toBeUndefined()
    const urls = artifactUrls('https://maven.neoforged.net/releases/a/b.jar', 'a/b.jar')
    expect(urls.every((url) => url.startsWith('https://'))).toBe(true)
    expect(urls).toContain('https://repo1.maven.org/maven2/a/b.jar')
    expect(urls).toContain('https://bmclapi2.bangbang93.com/maven/a/b.jar')
    expect(coordinateUrls(parseMavenCoordinate('org.ow2.asm:asm:9.6')!).every((url) => url.startsWith('https://'))).toBe(true)
  })

  it('collects real installer artifacts and skips data outputs', () => {
    const librariesRoot = join('C:', 'rhine', 'libraries')
    const profile = {
      spec: 1,
      version: '1.20.1-forge-47.4.28',
      minecraft: '1.20.1',
      libraries: [{
        name: 'com.google.code.gson:gson:2.10.1',
        downloads: { artifact: {
          path: 'com/google/code/gson/gson/2.10.1/gson-2.10.1.jar',
          url: 'https://libraries.minecraft.net/com/google/code/gson/gson/2.10.1/gson-2.10.1.jar',
          sha1: 'b3add478d4382b78ea20b1671390a858002feb6c',
          size: 283367,
        } },
      }],
      processors: [
        { sides: ['client'], jar: 'net.minecraftforge:installertools:1.4.1', classpath: ['org.ow2.asm:asm:9.6'] },
        { sides: ['server'], jar: 'server:only:1.0', classpath: ['server:only:1.0'] },
      ],
      data: { MAPPINGS: { client: '[de.oceanlabs.mcp:mcp_config:1.20.1:mappings@txt]' } },
    }
    const version = {
      id: '1.20.1-forge-47.4.28',
      inheritsFrom: '1.20.1',
      mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
      libraries: [{ name: 'net.minecraftforge:forge:1.20.1-47.4.28:universal' }],
    }
    const artifacts = collectInstallerArtifacts(profile, version, librariesRoot)
    expect(artifacts.some((item) => item.path.includes('gson-2.10.1.jar'))).toBe(true)
    expect(artifacts.some((item) => item.path.includes('installertools-1.4.1.jar'))).toBe(true)
    expect(artifacts.some((item) => item.path.includes('asm-9.6.jar'))).toBe(true)
    expect(artifacts.some((item) => item.path.includes('server/only'))).toBe(false)
    expect(artifacts.some((item) => item.path.includes('mappings'))).toBe(false)
    expect(artifacts.find((item) => item.path.includes('gson'))?.sha1).toBe('b3add478d4382b78ea20b1671390a858002feb6c')
    expect(processorCoordinates(profile as never)).toEqual(['net.minecraftforge:installertools:1.4.1', 'org.ow2.asm:asm:9.6'])
  })
})

describe('https downloads', () => {
  const roots: string[] = []
  afterEach(async () => {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
  })

  async function tempRoot(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-http-'))
    roots.push(root)
    return root
  }

  it('removes duplicates and rejects plain http', () => {
    expect(httpsCandidates([
      'https://a/x', 'https://a/x', 'http://insecure/x', undefined, 'https://b/y',
    ])).toEqual(['https://a/x', 'https://b/y'])
    expect(isHttpsUrl('http://a')).toBe(false)
    expect(isHttpsUrl('https://a')).toBe(true)
  })

  it('falls back to the next mirror for text', async () => {
    const response = await fetchText({
      async text(url: string) {
        if (url.includes('primary')) throw new Error('primary down')
        return 'ok'
      },
    }, ['https://primary/x', 'https://mirror/x'], '测试资源')
    expect(response.text).toBe('ok')
    expect(response.url).toBe('https://mirror/x')
  })

  it('verifies sha1 and tries the next candidate', async () => {
    const root = await tempRoot()
    const destination = join(root, 'lib.jar')
    const payload = makeZip([{ name: 'x.txt', content: 'payload' }])
    const attempts: string[] = []
    const result = await downloadVerified({
      async file(options: DownloadOptions) {
        attempts.push(options.url)
        if (attempts.length === 1) throw new Error('mirror down')
        await mkdir(join(options.destination, '..'), { recursive: true })
        await writeFile(options.destination, payload)
        return payload.length
      },
    }, {
      urls: ['https://primary/lib.jar', 'https://mirror/lib.jar'],
      destination,
      label: '测试库',
      sha1: sha1Of(payload),
      expectArchive: true,
    })
    expect(attempts).toEqual(['https://primary/lib.jar', 'https://mirror/lib.jar'])
    expect(result.source).toBe('https://mirror/lib.jar')
    expect(result.sha1).toBe(sha1Of(payload))
  })

  it('rejects hash mismatches and non-zip archives', async () => {
    const root = await tempRoot()
    const destination = join(root, 'bad.jar')
    const good = makeZip([{ name: 'x.txt', content: 'good' }])
    await expect(downloadVerified({
      async file(options: DownloadOptions) {
        await writeFile(options.destination, Buffer.from('not a zip'))
        return 9
      },
    }, {
      urls: ['https://a/bad.jar'],
      destination,
      label: '坏文件',
      sha1: sha1Of(good),
      expectArchive: true,
    })).rejects.toThrow(/无法下载/)
    await expect(downloadVerified({
      async file(options: DownloadOptions) {
        await writeFile(options.destination, Buffer.from('size is not integrity'))
        return 20
      },
    }, {
      urls: ['https://a/notzip.jar'],
      destination,
      label: '假 zip',
      expectArchive: true,
    })).rejects.toThrow(/无法下载/)
  })

  it('reads sha1/sha256 sidecars', async () => {
    const checksums = await fetchChecksums({
      async text(url: string) {
        if (url.endsWith('.sha1')) return 'a'.repeat(40) + '  file.jar'
        if (url.endsWith('.sha256')) return 'b'.repeat(64)
        throw new Error('missing')
      },
    }, ['https://mirror/file.jar'])
    expect(checksums).toEqual({ sha1: 'a'.repeat(40), sha256: 'b'.repeat(64) })
  })
})

/* ------------------------------------------------------------------ */
/* installed versions / detection                                      */
/* ------------------------------------------------------------------ */

describe('installed version detection', () => {
  const roots: string[] = []
  afterEach(async () => {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
  })

  async function setupVersions(): Promise<string> {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-io-'))
    roots.push(root)
    const versions = join(root, 'versions')
    const write = async (id: string, json: Record<string, unknown>, jar?: boolean): Promise<void> => {
      await mkdir(join(versions, id), { recursive: true })
      await writeFile(join(versions, id, id + '.json'), JSON.stringify(json))
      if (jar) await writeFile(join(versions, id, id + '.jar'), 'jar')
    }
    await write('1.20.1', { id: '1.20.1' }, true)
    await write('fabric-loader-0.16.9-1.20.1', {
      id: 'fabric-loader-0.16.9-1.20.1', inheritsFrom: '1.20.1',
      libraries: [{ name: 'net.fabricmc:fabric-loader:0.16.9' }],
    })
    await write('1.20.1-forge-47.4.28', {
      id: '1.20.1-forge-47.4.28', inheritsFrom: '1.20.1',
      libraries: [{ name: 'net.minecraftforge:forge:1.20.1-47.4.28' }],
    })
    await write('1.20.1-forge-47.1.106', {
      id: '1.20.1-forge-47.1.106', inheritsFrom: '1.20.1',
      mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
      libraries: [{ name: 'net.neoforged.fancymodloader:loader:47.2.2' }],
    })
    await write('1.20.1-OptiFine_HD_U_I5_pre4', {
      id: '1.20.1-OptiFine_HD_U_I5_pre4', inheritsFrom: '1.20.1',
      mainClass: 'net.minecraft.launchwrapper.Launch',
      arguments: { game: ['--tweakClass', 'optifine.OptiFineTweaker'], jvm: [] },
      libraries: [{ name: 'optifine:OptiFine:1.20.1_HD_U_I5_pre4' }],
    })
    await write('neoforge-21.1.209', {
      id: 'neoforge-21.1.209', inheritsFrom: '1.21.1',
      libraries: [{ name: 'net.neoforged:bus:8.0.5' }],
    })
    return versions
  }

  it('detects attachments with NeoForge 1.20.1 disambiguation', async () => {
    const versionsRoot = await setupVersions()
    const versions = await readInstalledVersions(versionsRoot)
    const specs = detectLoaderAttachments(versions, '1.20.1')
    expect(specs).toEqual([
      { kind: 'fabric', version: '0.16.9' },
      { kind: 'forge', version: '47.4.28' },
      { kind: 'neoforge', version: '47.1.106' },
      { kind: 'optifine', version: 'HD_U_I5_pre4' },
    ])
    expect(detectLoaderAttachments(versions, '1.21.1')).toEqual([{ kind: 'neoforge', version: '21.1.209' }])
  })

  it('writes version json atomically and preserves launcher profiles', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-io-'))
    roots.push(root)
    const file = await writeVersionJson(join(root, 'versions'), {
      id: 'fabric-loader-0.16.9-1.20.1',
      inheritsFrom: '1.20.1',
      mainClass: 'x',
    })
    expect(file).toBe(join(root, 'versions', 'fabric-loader-0.16.9-1.20.1', 'fabric-loader-0.16.9-1.20.1.json'))
    expect(await versionJsonExists(join(root, 'versions'), 'fabric-loader-0.16.9-1.20.1')).toBe(true)
    expect((await readVersionJson(join(root, 'versions'), 'fabric-loader-0.16.9-1.20.1'))?.mainClass).toBe('x')

    await ensureLauncherProfiles(root)
    const profileFile = join(root, 'launcher_profiles.json')
    const created = JSON.parse(await readFile(profileFile, 'utf8')) as { version: number }
    expect(created.version).toBe(3)
    await writeFile(profileFile, JSON.stringify({ profiles: { custom: {} }, version: 3 }))
    await ensureLauncherProfiles(root)
    const kept = JSON.parse(await readFile(profileFile, 'utf8')) as { profiles: Record<string, unknown> }
    expect(kept.profiles.custom).toBeDefined()
  })
})

/* ------------------------------------------------------------------ */
/* profile install / installer rollback                                */
/* ------------------------------------------------------------------ */

describe('profile install', () => {
  const roots: string[] = []
  afterEach(async () => {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
  })

  it('installs a fabric profile through the host capabilities', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-profile-'))
    roots.push(root)
    const host = makeHost(root, {
      text: async () => JSON.stringify({
        id: 'fabric-loader-0.16.9-1.20.1',
        inheritsFrom: '1.20.1',
        mainClass: 'net.fabricmc.loader.impl.launch.knot.KnotClient',
        libraries: [{ name: 'net.fabricmc:intermediary:1.20.1' }],
      }),
    })
    const id = await installProfileVersion(host, {
      id: 'fabric-loader-0.16.9-1.20.1',
      label: 'Fabric',
      profileUrls: ['https://meta.fabricmc.net/profile'],
      normalize: (payload) => normalizeFabricProfile(payload, '1.20.1', '0.16.9'),
    })
    expect(id).toBe('fabric-loader-0.16.9-1.20.1')
    const json = await readVersionJson(host.paths().versions, id)
    expect(json?.mainClass).toBe('net.fabricmc.loader.impl.launch.knot.KnotClient')
  })

  it('rolls back when verification fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-profile-'))
    roots.push(root)
    let installed = false
    const host = makeHost(root, {
      text: async () => JSON.stringify({ inheritsFrom: '1.20.1', mainClass: 'x' }),
      installed: async () => (installed ? ['fabric-loader-0.16.9-1.20.1'] : []),
    })
    await expect(installProfileVersion(host, {
      id: 'fabric-loader-0.16.9-1.20.1',
      label: 'Fabric',
      profileUrls: ['https://meta.fabricmc.net/profile'],
      normalize: (payload) => normalizeFabricProfile(payload, '1.20.1', '0.16.9'),
    })).rejects.toThrow(/未在已安装版本列表/)
    expect(await versionJsonExists(host.paths().versions, 'fabric-loader-0.16.9-1.20.1')).toBe(false)
    installed = true
  })
})

describe('forge/neoforge installer', () => {
  const roots: string[] = []
  afterEach(async () => {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
  })

  const GENERIC_JAR = makeZip([{ name: 'x.txt', content: 'generic' }])
  const VERSION_ID = '1.20.1-forge-47.2.0'
  const GENERATED = {
    id: VERSION_ID,
    inheritsFrom: '1.20.1',
    mainClass: 'cpw.mods.bootstraplauncher.BootstrapLauncher',
    libraries: [{ name: 'net.minecraftforge:forge:1.20.1-47.2.0' }],
  }
  const PROFILE = {
    spec: 1,
    version: VERSION_ID,
    minecraft: '1.20.1',
    libraries: [{
      name: 'org.ow2.asm:asm:9.6',
      downloads: { artifact: {
        path: 'org/ow2/asm/asm/9.6/asm-9.6.jar',
        url: 'https://maven.minecraftforge.net/org/ow2/asm/asm/9.6/asm-9.6.jar',
        sha1: sha1Of(GENERIC_JAR),
        size: GENERIC_JAR.length,
      } },
    }],
    processors: [],
  }
  const INSTALLER_ZIP = makeZip([
    { name: 'install_profile.json', content: JSON.stringify(PROFILE) },
    { name: 'version.json', content: JSON.stringify(GENERATED) },
  ])
  const INSTALLER_SHA1 = sha1Of(INSTALLER_ZIP)

  function options(runner: (java: string, args: string[], opts: { onLine?: (line: string, level: 'info' | 'warn') => void }) => Promise<void>) {
    return {
      kind: 'forge' as const,
      gameVersion: '1.20.1',
      loaderVersion: '47.2.0',
      label: 'Forge',
      installerUrls: ['https://maven.minecraftforge.net/forge-installer.jar'],
      expectedVersionId: VERSION_ID,
      javaMajor: 17,
      runner,
    }
  }

  function installerHost(root: string, failDependency = false): LoaderHost {
    return makeHost(root, {
      text: async (url: string) => {
        if (url.includes('installer.jar') && url.endsWith('.sha1')) return INSTALLER_SHA1
        throw new Error('no checksum: ' + url)
      },
      file: async (download: DownloadOptions) => {
        if (failDependency && !download.url.includes('installer.jar')) throw new Error('mirror down')
        const content = download.url.includes('installer.jar') ? INSTALLER_ZIP : GENERIC_JAR
        await mkdir(join(download.destination, '..'), { recursive: true })
        await writeFile(download.destination, content)
        return content.length
      },
    })
  }

  function fakeRunner(root: string) {
    return async () => {
      const dir = join(root, 'versions', VERSION_ID)
      await mkdir(dir, { recursive: true })
      await writeFile(join(dir, VERSION_ID + '.json'), JSON.stringify(GENERATED))
    }
  }

  it('validates the embedded profile before execution', () => {
    expect(validateInstallerPackage(PROFILE, GENERATED, {
      gameVersion: '1.20.1', expectedVersionId: VERSION_ID, label: 'Forge',
    })).toBe(VERSION_ID)
    expect(() => validateInstallerPackage(PROFILE, { ...GENERATED, inheritsFrom: '1.19.2' }, {
      gameVersion: '1.20.1', expectedVersionId: VERSION_ID, label: 'Forge',
    })).toThrow(/目标版本/)
    expect(() => validateInstallerPackage(PROFILE, GENERATED, {
      gameVersion: '1.20.1', expectedVersionId: 'other', label: 'Forge',
    })).toThrow(/版本 id/)
    expect(() => validateGeneratedVersion({ ...GENERATED, mainClass: '' } as never, VERSION_ID, '1.20.1', 'Forge'))
      .toThrow(/mainClass/)
  })

  it('prefetches dependencies and runs the installer', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-installer-'))
    roots.push(root)
    const host = installerHost(root)
    const id = await installWithInstaller(host, options(fakeRunner(root)))
    expect(id).toBe(VERSION_ID)
    expect(await versionJsonExists(host.paths().versions, VERSION_ID)).toBe(true)
    expect(await readFile(join(root, 'launcher_profiles.json'), 'utf8')).toContain('profiles')
    expect(await readFile(join(root, 'libraries/org/ow2/asm/asm/9.6/asm-9.6.jar')).then((b) => b.length)).toBe(GENERIC_JAR.length)
  })

  it('rolls back the version directory when prefetch fails', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-installer-'))
    roots.push(root)
    const host = installerHost(root, true)
    await expect(installWithInstaller(host, options(fakeRunner(root)))).rejects.toThrow(/无法下载/)
    expect(await versionJsonExists(host.paths().versions, VERSION_ID)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* optifine real patcher flow                                          */
/* ------------------------------------------------------------------ */

describe('optifine patcher install', () => {
  const roots: string[] = []
  afterEach(async () => {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
  })

  it('extracts launchwrapper, patches, and writes the tweak version json', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-optifine-'))
    roots.push(root)
    const launchwrapper = makeZip([
      { name: 'net/minecraft/launchwrapper/Launch.class', content: 'launch' },
      { name: 'META-INF/MANIFEST.MF', content: 'Manifest-Version: 1.0' },
    ])
    const installerZip = makeZip([
      { name: 'optifine/Patcher.class', content: 'patcher' },
      { name: 'launchwrapper-of.txt', content: '2.3' },
      { name: 'launchwrapper-of-2.3.jar', content: launchwrapper },
      { name: 'buildof.txt', content: '20230621-132930' },
    ])
    const list = JSON.stringify([{
      mcversion: '1.20.1', type: 'HD_U_I5', patch: 'pre4',
      filename: 'preview_OptiFine_1.20.1_HD_U_I5_pre4.jar',
    }])
    const paths = pathsOf(root)
    await mkdir(join(paths.versions, '1.20.1'), { recursive: true })
    await writeFile(join(paths.versions, '1.20.1', '1.20.1.json'), JSON.stringify({ id: '1.20.1', type: 'release' }))
    await writeFile(join(paths.versions, '1.20.1', '1.20.1.jar'), 'base client jar')

    const host = makeHost(root, {
      text: async (url: string) => {
        if (url.endsWith('/optifine/1.20.1')) return list
        throw new Error('no sidecar: ' + url)
      },
      file: async (download: DownloadOptions) => {
        if (!download.url.includes('/optifine/')) throw new Error('unexpected download ' + download.url)
        await mkdir(join(download.destination, '..'), { recursive: true })
        await writeFile(download.destination, installerZip)
        return installerZip.length
      },
      verify: async () => true,
    })
    const result = await installOptiFineDetailed(host, {
      gameVersion: '1.20.1',
      loaderVersion: 'HD_U_I5_pre4',
      runner: async (_java, args) => {
        const output = args[5]
        await mkdir(join(output, '..'), { recursive: true })
        await writeFile(output, makeZip([{ name: 'optifine/OptiFineTweaker.class', content: 'patched' }]))
      },
    })
    expect(result.id).toBe('1.20.1-OptiFine_HD_U_I5_pre4')
    expect(result.mainClass).toBe(OPTIFINE_MAIN_CLASS)
    expect(result.tweakClass).toBe(OPTIFINE_TWEAK_CLASS)
    expect(result.launchwrapper.version).toBe('2.3')
    expect(result.launchwrapper.sha1).toHaveLength(40)
    expect(result.patched.sha1).toHaveLength(40)
    const json = await readVersionJson(paths.versions, result.id)
    expect(json?.mainClass).toBe('net.minecraft.launchwrapper.Launch')
    expect((json?.arguments as { game: string[] }).game).toEqual(['--tweakClass', 'optifine.OptiFineTweaker'])
    const libraries = json?.libraries as { name: string }[]
    expect(libraries.map((library) => library.name)).toEqual([
      'optifine:OptiFine:1.20.1_HD_U_I5_pre4',
      'optifine:launchwrapper-of:2.3',
    ])
    await expect(stat(join(paths.libraries, 'optifine/OptiFine/1.20.1_HD_U_I5_pre4/OptiFine-1.20.1_HD_U_I5_pre4.jar')))
      .resolves.toBeTruthy()
    await expect(stat(join(paths.libraries, 'optifine/launchwrapper-of/2.3/launchwrapper-of-2.3.jar')))
      .resolves.toBeTruthy()
  })
})

/* ------------------------------------------------------------------ */
/* pure repository facade                                              */
/* ------------------------------------------------------------------ */

describe('loader repository facade', () => {
  const roots: string[] = []
  afterEach(async () => {
    while (roots.length > 0) await rm(roots.pop()!, { recursive: true, force: true })
  })

  it('dispatches through adapters without a kind switch', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-loader-repo-'))
    roots.push(root)
    const fabricPayload = JSON.stringify([{ loader: { version: '0.16.9', stable: true } }])
    const host = makeHost(root, { text: async () => fabricPayload })
    const repository = new LoaderService(host)
    expect(await repository.versions('fabric', '1.20.1')).toHaveLength(1)
    expect(() => repository.versions('vanilla', '1.20.1')).toThrow(/暂不支持/)
    expect(Object.keys(LOADER_ADAPTERS).sort()).toEqual(['fabric', 'forge', 'neoforge', 'optifine', 'quilt'])
  })
})