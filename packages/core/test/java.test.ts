import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import type { JavaRuntime } from '../src/types.ts'
import {
  commonJavaRoots, commonJavaScanRoots, dedupeJavaRuntimes, javaExecutableIn, javaMajorVersion,
  javaPathKey, looksLikeJavaDirectory, normalizeJavaArch, parseJavaProbe, parseJavaProperties,
  parseJavaVersionBanner, pathEntries, pickJavaRuntime, sortJavaRuntimes,
  type JavaCandidate,
} from '../src/java/discovery.ts'
import {
  buildJavaFilePlan, MOJANG_JAVA_CATALOG_URL, mojangPlatformKey, runtimeExecutablePath,
  safeJavaRelativePath, selectJavaRuntimeEntry,
} from '../src/java/mojang.ts'
import { JavaService } from '../src/services/java.ts'
import { PathsService } from '../src/services/paths.ts'
import { StorageService } from '../src/services/storage.ts'

/** Captured stderr of 'java -XshowSettings:properties -version'. */
const SHOW_SETTINGS = [
  'Property settings:',
  '    file.encoding = UTF-8',
  '    java.home = /opt/graalvm',
  '    java.version = 25.0.2',
  '    java.version.date = 2025-07-15',
  '    java.vendor = GraalVM Community',
  '    os.arch = amd64',
  '',
  'openjdk version "25.0.2" 2025-07-15',
  'OpenJDK Runtime Environment GraalVM CE 25.0.2 (build 25.0.2+10.1)',
  'OpenJDK 64-Bit Server VM GraalVM CE 25.0.2 (build 25.0.2+10.1, mixed mode)',
].join('\n')

/** Captured stderr of a legacy 'java -version'. */
const JAVA8_BANNER = [
  'java version "1.8.0_402"',
  'Java(TM) SE Runtime Environment (build 1.8.0_402-b06)',
  'Java HotSpot(TM) 64-Bit Server VM (build 25.402-b06, mixed mode)',
].join('\n')

function runtime(path: string, majorVersion: number, managed = false): JavaRuntime {
  return {
    path,
    version: majorVersion + '.0.1',
    majorVersion,
    vendor: 'Test',
    arch: 'x64',
    managed,
  }
}

function createContext(root: string): Context {
  const ctx = new Context()
  ctx.provide('paths', new PathsService(ctx, { root }))
  ctx.provide('storage', new StorageService(ctx))
  return ctx
}

/** Probe results come from a table so scan tests never spawn a JVM. */
class StubJavaService extends JavaService {
  constructor(ctx: Context, private readonly versions: Record<string, string>) {
    super(ctx)
  }

  protected override async probeExecutable(candidate: JavaCandidate): Promise<JavaRuntime | undefined> {
    const version = this.versions[candidate.path]
    if (!version) return undefined
    return {
      path: candidate.path,
      version,
      majorVersion: javaMajorVersion(version),
      vendor: 'GraalVM Community',
      arch: 'x64',
      managed: candidate.managed,
    }
  }
}

describe('java version parsing', () => {
  it('reads the -XshowSettings property dump', () => {
    const parsed = parseJavaProperties(SHOW_SETTINGS)
    expect(parsed).toEqual({ version: '25.0.2', vendor: 'GraalVM Community', arch: 'x64' })
  })

  it('falls back to the plain version banner', () => {
    expect(parseJavaVersionBanner(JAVA8_BANNER)).toEqual({
      version: '1.8.0_402',
      vendor: 'Oracle',
      arch: 'unknown',
    })
    expect(parseJavaVersionBanner('openjdk version "21.0.1" 2023-10-17').vendor).toBe('OpenJDK')
  })

  it('merges both representations', () => {
    const parsed = parseJavaProbe(SHOW_SETTINGS)
    expect(parsed?.version).toBe('25.0.2')
    expect(parsed?.arch).toBe('x64')
    expect(parseJavaProbe('nothing useful here')).toBeUndefined()
  })

  it('derives the major version from both naming schemes', () => {
    expect(javaMajorVersion('1.8.0_402')).toBe(8)
    expect(javaMajorVersion('25.0.2')).toBe(25)
    expect(javaMajorVersion('21.0.1+12')).toBe(21)
    expect(javaMajorVersion('17')).toBe(17)
    expect(javaMajorVersion('')).toBe(0)
    expect(javaMajorVersion('garbage')).toBe(0)
  })

  it('normalises architectures', () => {
    expect(normalizeJavaArch('amd64')).toBe('x64')
    expect(normalizeJavaArch('x86_64')).toBe('x64')
    expect(normalizeJavaArch('aarch64')).toBe('arm64')
    expect(normalizeJavaArch('x86')).toBe('x86')
    expect(normalizeJavaArch(undefined)).toBe('unknown')
    expect(normalizeJavaArch('sparc')).toBe('unknown')
  })
})

describe('java discovery candidates', () => {
  it('splits PATH entries and normalises duplicates', () => {
    expect(pathEntries('C:\\Java\\bin;D:\\tools;;', 'win32')).toEqual(['C:\\Java\\bin', 'D:\\tools'])
    expect(pathEntries('C:\\Java\\bin;c:\\java\\bin', 'win32')).toEqual(['C:\\Java\\bin'])
    expect(pathEntries('/usr/bin:/bin', 'linux')).toEqual(['/usr/bin', '/bin'])
  })

  it('knows the common vendor install roots', () => {
    const windows = commonJavaRoots({ ProgramFiles: 'C:\\Program Files' }, 'win32')
    expect(windows.some((root) => root.includes('GraalVM'))).toBe(true)
    expect(windows.some((root) => root.includes('Eclipse Adoptium'))).toBe(true)
    expect(windows.some((root) => root.includes('Amazon Corretto'))).toBe(true)
    expect(commonJavaRoots({}, 'linux')).toContain('/usr/lib/jvm')
    expect(commonJavaScanRoots('win32')).toContain('D:\\')
  })

  it('recognises jdk folder names', () => {
    expect(looksLikeJavaDirectory('graalvm-jdk-25.0.2+10.1')).toBe(true)
    expect(looksLikeJavaDirectory('jdk-21.0.1')).toBe(true)
    expect(looksLikeJavaDirectory('zulu21.32.17-ca-jdk21.0.2-win_x64')).toBe(true)
    expect(looksLikeJavaDirectory('Program Files')).toBe(false)
  })

  it('builds the bin/java path per platform', () => {
    expect(javaExecutableIn('/opt/jdk', 'linux')).toBe(join('/opt/jdk', 'bin', 'java'))
    expect(javaExecutableIn('C:\\Java', 'win32')).toBe(join('C:\\Java', 'bin', 'java.exe'))
    expect(javaPathKey('C:/Java/Bin/java.exe', 'win32')).toBe('c:/java/bin/java.exe')
  })
})

describe('java selection', () => {
  const list = [
    runtime('C:/jdk8/bin/java.exe', 8),
    runtime('C:/jdk17/bin/java.exe', 17),
    runtime('C:/jdk21/bin/java.exe', 21),
    runtime('C:/jdk21-managed/bin/java.exe', 21, true),
  ]

  it('prefers an exact major match', () => {
    expect(pickJavaRuntime(list, 17)?.majorVersion).toBe(17)
    expect(pickJavaRuntime(list, 21, 'C:/jdk21/bin/java.exe')?.path).toBe('C:/jdk21/bin/java.exe')
  })

  it('falls back to the nearest higher major version', () => {
    expect(pickJavaRuntime(list, 18)?.majorVersion).toBe(21)
    expect(pickJavaRuntime(list, 9)?.majorVersion).toBe(17)
  })

  it('falls back to any runtime when nothing is new enough', () => {
    expect(pickJavaRuntime(list, 30)?.majorVersion).toBe(21)
    expect(pickJavaRuntime([], 17)).toBeUndefined()
  })

  it('deduplicates executables and sorts for display', () => {
    const deduped = dedupeJavaRuntimes([
      runtime('C:/Java/bin/java.exe', 17),
      runtime('c:/java/bin/java.exe', 17),
      runtime('C:/other/bin/java.exe', 8),
    ], 'win32')
    expect(deduped).toHaveLength(2)
    expect(sortJavaRuntimes(deduped).map((item) => item.majorVersion)).toEqual([17, 8])
  })
})

describe('mojang runtime catalog', () => {
  const catalogue = {
    'windows-x64': {
      'java-runtime-gamma': [
        {
          manifest: { url: 'https://example.invalid/manifest.json', sha1: 'abc', size: 12 },
          version: { name: '17.0.15' },
        },
      ],
    },
  }

  it('selects the platform build of a component', () => {
    expect(mojangPlatformKey('win32', 'x64')).toBe('windows-x64')
    expect(mojangPlatformKey('win32', 'arm64')).toBe('windows-arm64')
    expect(mojangPlatformKey('darwin', 'arm64')).toBe('mac-os-arm64')
    expect(mojangPlatformKey('linux', 'x64')).toBe('linux')
    expect(selectJavaRuntimeEntry(catalogue, 'java-runtime-gamma', 'windows-x64')?.version.name).toBe('17.0.15')
    expect(selectJavaRuntimeEntry(catalogue, 'jre-legacy', 'windows-x64')).toBeUndefined()
    expect(selectJavaRuntimeEntry(undefined, 'java-runtime-gamma')).toBeUndefined()
  })

  it('rejects unsafe manifest paths', () => {
    expect(safeJavaRelativePath('bin/java.exe')).toBe('bin/java.exe')
    expect(safeJavaRelativePath('bin/./java.exe')).toBe('bin/java.exe')
    expect(safeJavaRelativePath('/bin/java.exe')).toBe('bin/java.exe')
    expect(safeJavaRelativePath('../escape.txt')).toBeUndefined()
    expect(safeJavaRelativePath('bin/../../escape.txt')).toBeUndefined()
    expect(safeJavaRelativePath('C:\\Windows\\system32\\x.dll')).toBeUndefined()
    expect(safeJavaRelativePath('')).toBeUndefined()
  })

  it('turns a manifest into a download plan', () => {
    const target = join('E:\\rhine', 'java', 'java-runtime-gamma')
    const plan = buildJavaFilePlan({
      files: {
        bin: { type: 'directory' },
        'bin/java.exe': {
          type: 'file',
          executable: true,
          downloads: { raw: { url: 'https://example.invalid/java.exe', sha1: 'abc', size: 10 } },
        },
        'lib/no-download.txt': { type: 'file' },
        'bin/server.dll': { type: 'link', target: './java.exe' },
        '../evil.txt': {
          type: 'file',
          downloads: { raw: { url: 'https://example.invalid/evil.txt' } },
        },
      },
    }, target)

    expect(plan.files).toHaveLength(1)
    expect(plan.files[0]).toMatchObject({
      url: 'https://example.invalid/java.exe',
      sha1: 'abc',
      size: 10,
      skipIfExists: true,
    })
    expect(plan.files[0].destination).toBe(join(target, 'bin', 'java.exe'))
    expect(plan.directories).toEqual([join(target, 'bin')])
    expect(plan.executables).toEqual([join(target, 'bin', 'java.exe')])
    expect(plan.links).toEqual([{ path: join(target, 'bin', 'server.dll'), target: 'java.exe' }])
    expect(runtimeExecutablePath(target, 'win32')).toBe(join(target, 'bin', 'java.exe'))
  })
})

describe('JavaService scan', () => {
  const cleanups: string[] = []

  afterEach(async () => {
    vi.unstubAllEnvs()
    while (cleanups.length > 0) {
      const root = cleanups.pop()!
      await rm(root, { recursive: true, force: true })
    }
  })

  it('walks the managed directory, dedupes and caches the result', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-java-'))
    cleanups.push(root)
    const java25 = join(root, 'java', 'graalvm-jdk-25', 'bin', 'java.exe')
    const java17 = join(root, 'java', 'jdk-17', 'bin', 'java.exe')
    for (const exe of [java25, java17]) {
      await mkdir(dirname(exe), { recursive: true })
      await writeFile(exe, '')
    }
    const ctx = createContext(root)
    const service = new StubJavaService(ctx, { [java25]: '25.0.2', [java17]: '17.0.11' })

    const runtimes = await service.scan()
    expect(runtimes.map((item) => item.majorVersion)).toEqual([25, 17])
    expect(runtimes.every((item) => item.managed)).toBe(true)
    expect(service.cached()).toHaveLength(2)
    expect(service.pick(17)?.majorVersion).toBe(17)
    expect(service.pick(8)?.majorVersion).toBe(17)
    expect(service.pick(21)?.majorVersion).toBe(25)
    expect(service.pick(30)?.majorVersion).toBe(25)
    expect(service.pick(25, java25)?.path).toBe(java25)

    const persisted = JSON.parse(await readFile(join(root, 'java', 'runtimes.json'), 'utf8')) as JavaRuntime[]
    expect(persisted).toHaveLength(2)
  })

  it('does not list the same executable twice when JAVA_HOME points at it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-java-'))
    cleanups.push(root)
    const exe = join(root, 'java', 'jdk-17', 'bin', 'java.exe')
    await mkdir(dirname(exe), { recursive: true })
    await writeFile(exe, '')
    vi.stubEnv('JAVA_HOME', join(root, 'java', 'jdk-17'))
    const ctx = createContext(root)
    const service = new StubJavaService(ctx, { [exe]: '17.0.11' })
    expect(await service.scan()).toHaveLength(1)
  })

  it('returns an empty list when nothing is installed', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-java-'))
    cleanups.push(root)
    const ctx = createContext(root)
    const service = new StubJavaService(ctx, {})
    expect(await service.scan()).toEqual([])
    expect(service.cached()).toEqual([])
  })

  it('downloads and registers a Mojang runtime', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-java-'))
    cleanups.push(root)
    const ctx = createContext(root)
    const platformKey = mojangPlatformKey()
    const manifest = {
      files: {
        bin: { type: 'directory' },
        'bin/java.exe': {
          type: 'file',
          executable: true,
          downloads: { raw: { url: 'https://example.invalid/java.exe' } },
        },
        'release': {
          type: 'file',
          downloads: { raw: { url: 'https://example.invalid/release' } },
        },
      },
    }
    const catalogue = {
      [platformKey]: {
        'java-runtime-gamma': [{
          manifest: { url: 'https://example.invalid/manifest.json', sha1: 'abc', size: 2 },
          version: { name: '17.0.15' },
        }],
      },
    }
    const downloads: string[] = []
    ctx.provide('download', {
      async text(url: string) {
        if (url !== MOJANG_JAVA_CATALOG_URL) throw new Error('unexpected text: ' + url)
        return JSON.stringify(catalogue)
      },
      async file(options: { url: string; destination: string }) {
        downloads.push(options.url)
        await mkdir(dirname(options.destination), { recursive: true })
        await writeFile(options.destination, JSON.stringify(manifest))
        return 1
      },
      async batch(items: { url: string; destination: string }[]) {
        for (const item of items) {
          downloads.push(item.url)
          await mkdir(dirname(item.destination), { recursive: true })
          await writeFile(item.destination, 'stub')
        }
      },
      async buffer() {
        return new Uint8Array()
      },
    } as never)

    const service = new JavaService(ctx)
    const installed = await service.install('java-runtime-gamma')
    const target = join(root, 'java', 'java-runtime-gamma')
    expect(installed.path).toBe(join(target, 'bin', 'java.exe'))
    expect(installed.managed).toBe(true)
    expect(installed.majorVersion).toBe(17)
    expect(installed.version).toBe('17.0.15')
    expect((await stat(join(target, 'release'))).isFile()).toBe(true)
    expect(downloads).toContain('https://example.invalid/java.exe')
    expect(service.cached().some((item) => item.path === installed.path)).toBe(true)
  })

  it('reports a chinese error for unknown components', async () => {
    const root = await mkdtemp(join(tmpdir(), 'rhine-java-'))
    cleanups.push(root)
    const ctx = createContext(root)
    ctx.provide('download', {
      async text() {
        return JSON.stringify({})
      },
      async file() {
        return 0
      },
      async batch() {},
      async buffer() {
        return new Uint8Array()
      },
    } as never)
    const service = new JavaService(ctx)
    await expect(service.install('java-runtime-gamma')).rejects.toThrow(/Mojang 没有为/)
    await expect(service.install('  ')).rejects.toThrow(/不能为空/)
  })
})
