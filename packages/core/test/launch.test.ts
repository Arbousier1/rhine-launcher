import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { crc32, deflateRawSync } from 'node:zlib'
import { installCore } from './support/implementation-fixtures.ts'
import { instancesPlugin } from './support/implementation-fixtures.ts'
import { DiagnosticsService, LaunchError, classifyLine, compactUuid, logFileStamp, quoteArg, requiredJavaMajor } from '../src/services/launch.ts'
import { diagnosticsPlugin, launchPlugin } from './support/implementation-fixtures.ts'
import { analyzeCrash, analyzeLog, exitCodeFindings, tailLines } from '../src/runtime/crash.ts'
import { extractNatives, shouldExtract, cleanDirectory, nativeExtensions } from '../src/runtime/natives.ts'
import type { RhContext } from '../src/contracts.ts'
import type { InstanceConfig, LaunchSession, ServerEvent } from '../src/types.ts'

/* ------------------------------------------------------------------ */
/* fixtures: a real zip writer for natives, a fake "java" that records */
/* ------------------------------------------------------------------ */

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

/** A stand-in for the java executable that prints lines and exits. */
const FAKE_JAVA = [
  '/* fake java */',
  'import { appendFileSync } from "node:fs"',
  'const sink = process.env.FAKE_JAVA_OUT',
  'const emit = (stream, line) => { if (sink) appendFileSync(sink, stream + "|" + line + "\\n"); }',
  'const args = process.argv.slice(2)',
  'console.log("FAKE_GAME main"); emit("out", "FAKE_GAME main")',
  'console.error("FAKE stderr warn line"); emit("err", "FAKE stderr warn line")',
  'console.log("args:" + args.length); emit("out", "args:" + args.length)',
  'process.exitCode = Number(process.env.FAKE_EXIT_CODE ?? 3)',
].join('\n')

/**
 * Return an executable path the OS can spawn directly.
 * On Windows spawn cannot run a .mjs file (no shebang support), so we emit a
 * tiny .cmd wrapper that re-enters node.
 */
async function writeFakeJava(directory: string): Promise<string> {
  const script = join(directory, 'fake-java.mjs')
  await writeFile(script, FAKE_JAVA, 'utf8')
  if (process.platform !== 'win32') return script
  const wrapper = join(directory, 'fake-java.cmd')
  // process.execPath may be an Electron host (e.g. under DSH); prefer the real node from PATH.
  const nodeBin = (process.env.PATH?.split(process.platform === 'win32' ? ';' : ':').find((dir) => {
    try { require('node:fs').statSync(require('node:path').join(dir, 'node.exe')); return true } catch { return false }
  }) ?? '') ? 'node' : process.execPath
  // Intentionally do not forward %*: cmd.exe splits arguments containing spaces
  // (e.g. -Dminecraft.launcher.brand=Rhine Launcher), which would break the fake
  // java. The fake script ignores its arguments anyway.
  await writeFile(wrapper, '@echo off\r\n' + nodeBin + ' "' + script + '"\r\n', 'utf8')
  return wrapper
}

const CONFIG: InstanceConfig = {
  name: '启动测试',
  gameVersion: '1.20.1',
  loaders: [],
  memory: { minMb: 1024, maxMb: 2048 },
  jvmArgs: ['-Duser.language=zh'],
  gameArgs: [],
  window: { width: 1280, height: 720, fullscreen: false },
}

function versionJson(overrides: Record<string, unknown> = {}) {
  return {
    id: '1.20.1',
    type: 'release',
    mainClass: 'net.minecraft.client.main.Main',
    assetIndex: { id: '5', url: 'https://example.invalid/index.json', sha1: createHash('sha1').update('{"objects":{}}').digest('hex'), size:14 },
    assets: '5',
    javaVersion: { component: 'java-runtime-gamma', majorVersion: 17 },
    libraries: [
      {
        name: 'com.mojang:brigadier:1.0.18',
        downloads: {
          artifact: {
            url: 'https://example.invalid/brigadier.jar',
            path: 'com/mojang/brigadier/1.0.18/brigadier-1.0.18.jar',
            sha1: createHash('sha1').update('LIBRARY').digest('hex'),
            size:7,
          },
        },
      },
    ],
    arguments: {
      game: [['--username', '${auth_player_name}', '--version', '${version_name}', '--gameDir', '${game_directory}']],
      jvm: [['-cp', '${classpath}']],
    },
    ...overrides,
  }
}

/* ------------------------------------------------------------------ */
/* pure helpers                                                        */
/* ------------------------------------------------------------------ */

describe('launch helpers', () => {
  it('formats log file names', () => {
    expect(logFileStamp(new Date('2026-01-02T03:04:05.678Z'))).toBe('2026-01-02_03-04-05-678')
  })

  it('compacts uuids for --uuid', () => {
    expect(compactUuid('069A79F4-44E9-4726-A5BE-FCA90E38AAF5')).toBe('069a79f444e94726a5befca90e38aaf5')
    expect(compactUuid('069a79f444e94726a5befca90e38aaf5')).toBe('069a79f444e94726a5befca90e38aaf5')
  })

  it('derives the required java major version', () => {
    expect(requiredJavaMajor({ id: 'x', javaVersion: { component: 'a', majorVersion: 21 } }, '1.20.1')).toBe(21)
    expect(requiredJavaMajor({ id: 'x' }, '1.12.2')).toBe(8)
    expect(requiredJavaMajor({ id: 'x' }, '1.16.5')).toBe(8)
    expect(requiredJavaMajor({ id: 'x' }, '1.17')).toBe(16)
    expect(requiredJavaMajor({ id: 'x' }, '1.18.2')).toBe(17)
    expect(requiredJavaMajor({ id: 'x' }, '1.20.4')).toBe(17)
    expect(requiredJavaMajor({ id: 'x' }, '1.20.5')).toBe(21)
    expect(requiredJavaMajor({ id: 'x' }, '1.21.4')).toBe(21)
    expect(requiredJavaMajor({ id: 'x' }, '26.3')).toBe(21)
    expect(requiredJavaMajor({ id: 'x' }, '')).toBe(8)
  })

  it('classifies log lines', () => {
    expect(classifyLine('java.lang.NullPointerException', 'info')).toBe('error')
    expect(classifyLine('[main/ERROR]: boom', 'info')).toBe('error')
    expect(classifyLine('[main/WARN]: careful', 'info')).toBe('warn')
    expect(classifyLine('[main/DEBUG]: detail', 'info')).toBe('debug')
    expect(classifyLine('all good', 'info')).toBe('info')
    expect(classifyLine('all good', 'warn')).toBe('warn')
  })

  it('quotes arguments for display', () => {
    expect(quoteArg('plain')).toBe('plain')
    expect(quoteArg('with space')).toBe('"with space"')
    expect(quoteArg('')).toBe('""')
  })

  it('exposes LaunchError', () => {
    const error = new LaunchError('boom')
    expect(error.name).toBe('LaunchError')
    expect(error.message).toBe('boom')
  })
})

/* ------------------------------------------------------------------ */
/* crash analysis                                                      */
/* ------------------------------------------------------------------ */

describe('runtime/crash', () => {
  it('recognises an outdated java runtime', () => {
    const findings = analyzeLog('java.lang.UnsupportedClassVersionError: net/minecraft/client/main/Main')
    expect(findings[0].level).toBe('error')
    expect(findings[0].message).toContain('Java 版本过低')
    expect(findings[0].hint).toContain('17')
  })

  it('recognises out of memory', () => {
    const findings = analyzeLog('java.lang.OutOfMemoryError: Java heap space')
    expect(findings.some((finding) => finding.message.includes('内存不足'))).toBe(true)
  })

  it('recognises missing mod dependencies', () => {
    const findings = analyzeLog('Missing or unsupported mandatory dependencies: fabric-api')
    expect(findings.some((finding) => finding.message.includes('依赖缺失'))).toBe(true)
  })

  it('recognises OpenGL and hs_err crashes', () => {
    const opengl = analyzeLog('org.lwjgl.opengl.GLException: Failed to create window')
    expect(opengl.some((finding) => finding.message.includes('OpenGL'))).toBe(true)
    const jvm = analyzeLog('A fatal error has been detected by the Java Runtime Environment:')
    expect(jvm.some((finding) => finding.message.includes('虚拟机崩溃'))).toBe(true)
  })

  it('reports more than one finding when several signatures hit', () => {
    const findings = analyzeLog([
      'java.lang.OutOfMemoryError: Java heap space',
      'Mixin apply failed: mixin.example.json',
    ].join('\n'))
    expect(findings.length).toBeGreaterThanOrEqual(2)
  })

  it('says so when nothing matches', () => {
    expect(analyzeLog('Game started normally').at(-1)?.level).toBe('info')
    expect(analyzeLog('')).toEqual([])
  })

  it('maps exit codes to hints', () => {
    expect(exitCodeFindings(0)[0].level).toBe('info')
    expect(exitCodeFindings(1)[0].level).toBe('error')
    expect(exitCodeFindings(-1073741819).some((finding) => finding.message.includes('0xC0000005'))).toBe(true)
    expect(exitCodeFindings(137)[0].level).toBe('warn')
    expect(exitCodeFindings(null)[0].level).toBe('warn')
  })

  it('combines log findings with exit codes', () => {
    expect(analyzeCrash('java.lang.OutOfMemoryError: x', 1).length).toBeGreaterThanOrEqual(2)
  })

  it('tails a log', () => {
    expect(tailLines('a\nb\nc', 2)).toBe('b\nc')
    expect(tailLines('a', 10)).toBe('a')
  })
})

/* ------------------------------------------------------------------ */
/* natives                                                             */
/* ------------------------------------------------------------------ */

describe('runtime/natives', () => {
  it('filters excluded prefixes', () => {
    expect(shouldExtract('lwjgl.dll', ['META-INF/'])).toBe(true)
    expect(shouldExtract('META-INF/MANIFEST.MF', ['META-INF/'])).toBe(false)
    expect(shouldExtract('foo/bar.txt', ['foo/'])).toBe(false)
    expect(shouldExtract('foo.txt', ['foo/'])).toBe(true)
    expect(shouldExtract('dir/', [])).toBe(false)
  })

  it('refuses path traversal', () => {
    expect(shouldExtract('../evil.dll', [])).toBe(false)
    expect(shouldExtract('a/../../evil.dll', [])).toBe(false)
  })

  it('extracts a real natives jar and skips META-INF', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-natives-'))
    try {
      const jar = join(dir, 'lwjgl-natives.jar')
      await writeFile(jar, makeZip([
        { name: 'META-INF/MANIFEST.MF', content: 'Manifest-Version: 1.0' },
        { name: 'lwjgl.dll', content: 'binary' },
        { name: 'sub/other.dll', content: 'other' },
      ]))
      const destination = join(dir, 'out')
      const result = await extractNatives(jar, destination)
      expect(result.files).toEqual(['lwjgl.dll', 'sub/other.dll'])
      expect(result.skipped).toBe(1)
      expect(await readFile(join(destination, 'lwjgl.dll'), 'utf8')).toBe('binary')
      expect(await stat(join(destination, 'META-INF')).catch(() => undefined)).toBeUndefined()
      expect((await extractNatives(jar, destination)).files).toHaveLength(2)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('fails clearly on a missing or invalid jar', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-natives-'))
    try {
      await expect(extractNatives(join(dir, 'nope.jar'), join(dir, 'out'))).rejects.toThrow(/不存在/)
      const bad = join(dir, 'bad.jar')
      await writeFile(bad, 'not a zip')
      await expect(extractNatives(bad, join(dir, 'out2'))).rejects.toThrow(/无法读取/)
      const empty = join(dir, 'empty.jar')
      await writeFile(empty, makeZip([{ name: 'META-INF/x.txt', content: 'x' }]))
      await expect(extractNatives(empty, join(dir, 'out3'))).rejects.toThrow(/没有可解压/)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('cleans a directory without removing it', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'rhine-clean-'))
    try {
      await writeFile(join(dir, 'a.txt'), 'x')
      await mkdir(join(dir, 'sub'))
      await cleanDirectory(dir)
      expect(await readdir(dir)).toEqual([])
      expect((await stat(dir)).isDirectory()).toBe(true)
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  })

  it('knows platform native extensions', () => {
    expect(nativeExtensions('windows')).toEqual(['.dll'])
    expect(nativeExtensions('osx')).toContain('.dylib')
    expect(nativeExtensions('linux')).toEqual(['.so'])
  })
})

/* ------------------------------------------------------------------ */
/* LaunchService integration                                           */
/* ------------------------------------------------------------------ */

describe('LaunchService', () => {
  let root = ''
  let ctx: RhContext
  let instanceId = ''
  const versionId = '1.20.1'

  function javaRuntime(path: string) {
    return {
      path, version: '17.0.2', majorVersion: 17, vendor: 'Test',
      arch: 'x64' as const, managed: false,
    }
  }
  function account() {
    return {
      id: 'acct', kind: 'offline' as const, name: 'Steve',
      uuid: '069a79f444e94726a5befca90e38aaf5', accessToken: '0',
    }
  }

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'rhine-launch-'))
    ctx = new Context() as unknown as RhContext
    await installCore(ctx as never, { root })
    await (ctx.plugin(instancesPlugin as never) as unknown as PromiseLike<unknown>)
    await ctx.paths.ensure()

    const version = versionJson()
    const javaPath = await writeFakeJava(root)

    // The launch service consumes meta/java/accounts through their contracts;
    // minimal in-memory doubles keep this suite focused on the launch pipeline
    // while still spawning a real child process.
    const metaStub = {
      async remoteVersions() { return [] },
      async remoteVersion() { return undefined },
      async versionJson() { return version },
      async versionChain() { return [version] },
      async installed() { return [versionId] },
      async resolvedJson() { return version },
    }
    const javaStub = {
      cached() { return [javaRuntime(javaPath)] },
      async scan() { return [javaRuntime(javaPath)] },
      pick() { return javaRuntime(javaPath) },
      async install() { return javaRuntime(javaPath) },
    }
    const accountsStub = {
      list() { return [] },
      get(id: string) { return id === 'acct' ? account() : undefined },
      async addOffline() { return account() },
      async remove() {},
      async beginMicrosoft() { throw new Error('无法使用在线账号') },
      async completeMicrosoft() { return account() },
      async refresh() { return account() },
      async authorize(id: string) {
        if (id !== 'acct') throw new Error('账号不存在：' + id)
        return account()
      },
    }
    ctx.provide('meta', metaStub as never)
    ctx.provide('java', javaStub as never)
    ctx.provide('accounts', accountsStub as never)

    const instance = await ctx.instances.create(CONFIG)
    instanceId = instance.id

    const versionsDir = join(ctx.paths.get().versions, versionId)
    await mkdir(versionsDir, { recursive: true })
    await writeFile(join(versionsDir, versionId + '.jar'), 'PLACEHOLDER')
    await writeFile(join(versionsDir, versionId + '.json'), JSON.stringify(version))

    // Materialise every file the launch planner would download, so the tests
    // exercise the real pipeline without touching the network.
    const libraryFile = join(
      ctx.paths.get().libraries, 'com', 'mojang', 'brigadier', '1.0.18', 'brigadier-1.0.18.jar',
    )
    await mkdir(join(libraryFile, '..'), { recursive: true })
    await writeFile(libraryFile, 'LIBRARY')
    const assetIndex = join(ctx.paths.get().assets, 'indexes', '5.json')
    await mkdir(join(assetIndex, '..'), { recursive: true })
    await writeFile(assetIndex, '{"objects":{}}')

    await (ctx.plugin(launchPlugin as never) as unknown as PromiseLike<unknown>)
    await (ctx.plugin(diagnosticsPlugin as never) as unknown as PromiseLike<unknown>)
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('builds a command without starting anything', async () => {
    const built = await ctx.launch.buildCommand({ instanceId, accountId: 'acct' })
    expect(built.command[0]).toContain('fake-java')
    expect(built.mainClass).toBe('net.minecraft.client.main.Main')
    expect(built.command).toContain('-Xmx2048m')
    expect(built.command).toContain('-Duser.language=zh')
    expect(built.command.join(' ')).toContain('--username Steve')
    expect(built.cwd).toContain(instanceId)
  })

  it('runs a real process, streams its output and records the session', async () => {
    const events: ServerEvent[] = []
    const unsubscribe = ctx.bus.subscribe((event) => events.push(event))
    process.env.FAKE_EXIT_CODE = '3'
    process.env.FAKE_JAVA_OUT = join(root, 'fake-java-out.log')
    await writeFile(process.env.FAKE_JAVA_OUT, '')
    try {
      const session = await ctx.launch.launch({ instanceId, accountId: 'acct' })
      expect(session.id).toMatch(/^session-/)
      expect(session.instanceId).toBe(instanceId)
      expect(session.accountName).toBe('Steve')
      expect(session.logFile.length).toBeGreaterThan(0)

      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const current = ctx.launch.session(session.id)
        if (current && (current.status === 'exited' || current.status === 'crashed')) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }

      const done = ctx.launch.session(session.id)!
      expect(done.endedAt).toBeGreaterThan(0)
      expect(done.exitCode).toBe(3)
      expect(done.status).toBe('crashed')

      const logText = await readFile(done.logFile, 'utf8')
      // The service always records the command it ran and how the process ended.
      expect(logText).toContain(done.command[0])
      expect(logText).toContain('进程退出，退出码 3')

      // The child really executed: it wrote both streams through the sink that the
      // fake java receives via the inherited environment.
      const sinkText = await readFile(process.env.FAKE_JAVA_OUT!, 'utf8')
      expect(sinkText).toContain('FAKE_GAME main')
      expect(sinkText).toContain('FAKE stderr warn line')

      expect(events.some((event) => event.type === 'launch-log')).toBe(true)
      expect(events.some((event) => event.type === 'launch-exit')).toBe(true)

      const stored = JSON.parse(await readFile(join(ctx.paths.get().root, 'launch-sessions.json'), 'utf8'))
      expect(stored.some((item: LaunchSession) => item.id === session.id)).toBe(true)
    } finally {
      delete process.env.FAKE_EXIT_CODE
      unsubscribe()
    }
  }, 30000)

  it('records the launch on the instance', () => {
    const instance = ctx.instances.get(instanceId)!
    expect(instance.lastLaunchedAt).toBeGreaterThan(0)
  })

  it('lists sessions newest first', () => {
    const sessions = ctx.launch.sessions()
    expect(sessions.length).toBeGreaterThan(0)
    const sorted = [...sessions].sort((a, b) => b.startedAt - a.startedAt)
    expect(sessions.map((session) => session.id)).toEqual(sorted.map((session) => session.id))
  })

  it('refuses to kill a finished session', async () => {
    const session = ctx.launch.sessions()[0]
    await expect(ctx.launch.kill(session.id)).rejects.toThrow(/已经结束|会话不存在/)
    await expect(ctx.launch.kill('nope')).rejects.toThrow(/会话不存在/)
  })

  it('reports a Chinese error for an unknown instance or account', async () => {
    await expect(ctx.launch.launch({ instanceId: 'ghost', accountId: 'acct' })).rejects.toThrow(/实例不存在/)
    await expect(ctx.launch.buildCommand({ instanceId, accountId: 'ghost' })).rejects.toThrow(/账号不存在/)
  })

  it('keeps the log directory bounded', async () => {
    await ctx.settings.update({ keepLogs: 3 })
    const logDir = join(ctx.instances.get(instanceId)!.path, '.rhine', 'logs')
    for (const name of ['a.log', 'b.log', 'c.log', 'd.log', 'e.log']) {
      await writeFile(join(logDir, name), 'x')
    }
    process.env.FAKE_EXIT_CODE = '0'
    try {
      const session = await ctx.launch.launch({ instanceId, accountId: 'acct' })
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const current = ctx.launch.session(session.id)
        if (current && (current.status === 'exited' || current.status === 'crashed')) break
        await new Promise((resolve) => setTimeout(resolve, 50))
      }
      expect(ctx.launch.session(session.id)!.status).toBe('exited')
      const files = (await readdir(logDir)).filter((name) => name.endsWith('.log'))
      expect(files.length).toBeLessThanOrEqual(4)
    } finally {
      delete process.env.FAKE_EXIT_CODE
    }
  }, 30000)

  it('returns the tail of a session log', async () => {
    const session = ctx.launch.sessions()[0]
    const tail = ctx.launch.log(session.id, 1)
    expect(tail.length).toBeLessThanOrEqual(1)
    expect(ctx.launch.log('ghost')).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* DiagnosticsService                                                  */
/* ------------------------------------------------------------------ */

describe('DiagnosticsService', () => {
  let root = ''
  let ctx: RhContext
  let instanceId = ''

  beforeAll(async () => {
    root = await mkdtemp(join(tmpdir(), 'rhine-diag-'))
    ctx = new Context() as unknown as RhContext
    await installCore(ctx as never, { root })
    await (ctx.plugin(instancesPlugin as never) as unknown as PromiseLike<unknown>)
    await (ctx.plugin(diagnosticsPlugin as never) as unknown as PromiseLike<unknown>)
    await ctx.paths.ensure()
    instanceId = (await ctx.instances.create(CONFIG)).id
  })

  afterAll(async () => {
    await rm(root, { recursive: true, force: true })
  })

  it('registers the optional diagnostics service', () => {
    expect(ctx.diagnostics).toBeInstanceOf(DiagnosticsService)
  })

  it('reports "no log" when the instance never launched', async () => {
    const findings = await ctx.diagnostics!.analyze(instanceId)
    expect(findings[0].level).toBe('info')
    expect(findings[0].message).toContain('没有找到')
  })

  it('analyses the newest launcher log of an instance', async () => {
    const instance = ctx.instances.get(instanceId)!
    const logDir = join(instance.path, '.rhine', 'logs')
    await mkdir(logDir, { recursive: true })
    await writeFile(join(logDir, '2026-01-01_00-00-00-000.log'), 'old\n')
    await writeFile(join(logDir, '2026-01-02_00-00-00-000.log'), [
      '[main/ERROR]: java.lang.OutOfMemoryError: Java heap space',
      'Mixin apply failed: example.mixins.json',
    ].join('\n'))
    const findings = await ctx.diagnostics!.analyze(instanceId)
    expect(findings.some((finding) => finding.message.includes('内存不足'))).toBe(true)
    expect(findings.some((finding) => finding.message.includes('Mixin'))).toBe(true)
  })

  it('falls back to logs/latest.log inside the instance', async () => {
    const instance = ctx.instances.get(instanceId)!
    await rm(join(instance.path, '.rhine', 'logs'), { recursive: true, force: true })
    await writeFile(join(instance.path, 'logs', 'latest.log'), 'org.lwjgl.opengl.GLException: boom')
    const findings = await ctx.diagnostics!.analyze(instanceId)
    expect(findings.some((finding) => finding.message.includes('OpenGL'))).toBe(true)
  })

  it('rejects unknown instances', async () => {
    await expect(ctx.diagnostics!.analyze('ghost')).rejects.toThrow(/实例不存在/)
  })
})
