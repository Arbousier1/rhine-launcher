import { describe, expect, it } from 'vitest'
import type { RawVersionJson } from '../src/contracts.ts'
import type { InstanceConfig } from '../src/types.ts'
import {
  archAliases, currentPlatform, isAllowed, normalizeArch, osFromPlatform, resolveRuleAction,
  type PlatformInfo,
} from '../src/runtime/rules.ts'
import {
  evaluateArguments, expandVariables, flattenArgumentGroups, resolveArgumentEntry,
  tokenizeArguments,
} from '../src/runtime/arguments.ts'
import {
  buildCommand, classpathFromPlans, defaultGameArguments, ensureAuthArguments, mavenPath,
  parseMaven, planLibraries, resolveNativesClassifier, sanitiseJvmArgs,
  type BuildCommandInput,
} from '../src/runtime/command.ts'

const WINDOWS: PlatformInfo = { os: 'windows', arch: 'x64', version: '10.0', label: 'windows-x64' }
const LINUX: PlatformInfo = { os: 'linux', arch: 'x64', version: '6.1.0', label: 'linux-x64' }
const MAC_ARM: PlatformInfo = { os: 'osx', arch: 'arm64', version: '14.1.0', label: 'osx-arm64' }

const INSTANCE: InstanceConfig = {
  name: '测试档案',
  gameVersion: '1.20.1',
  loaders: [{ kind: 'fabric', version: '0.16.9' }],
  memory: { minMb: 1024, maxMb: 4096 },
  jvmArgs: [],
  gameArgs: [],
  window: { width: 1280, height: 720, fullscreen: false },
}

const AUTH = {
  username: 'Steve',
  uuid: '069a79f444e94726a5befca90e38aaf5',
  accessToken: 'token-123',
  userType: 'msa',
}

function baseInput(version: RawVersionJson, overrides: Partial<BuildCommandInput> = {}): BuildCommandInput {
  return {
    version,
    versionName: '1.20.1',
    instance: INSTANCE,
    gameDir: 'E:/instances/test',
    assetsDir: 'E:/assets',
    librariesDir: 'E:/libraries',
    classpath: ['E:/libraries/a.jar', 'E:/libraries/b.jar'],
    versionJar: 'E:/versions/1.20.1/1.20.1.jar',
    nativesDir: 'E:/instances/test/natives',
    javaPath: 'C:/jdk/bin/java.exe',
    javaMajor: 17,
    auth: AUTH,
    platform: WINDOWS,
    pathSeparator: ';',
    ...overrides,
  }
}

const MODERN: RawVersionJson = {
  id: '1.20.1',
  type: 'release',
  mainClass: 'net.minecraft.client.main.Main',
  assetIndex: { id: '5', url: 'https://x/index.json' },
  arguments: {
    game: [
      ['--username', '${auth_player_name}', '--version', '${version_name}'],
      ['--gameDir', '${game_directory}', '--assetsDir', '${assets_root}'],
      ['--assetIndex', '${assets_index_name}', '--uuid', '${auth_uuid}'],
      ['--accessToken', '${auth_access_token}', '--userType', '${user_type}'],
      [
        { rules: [{ action: 'allow', features: { has_custom_resolution: true } }], value: ['--width', '${resolution_width}', '--height', '${resolution_height}'] },
        { rules: [{ action: 'allow', os: { name: 'osx' } }], value: ['--macOnlyArg'] },
      ],
    ],
    jvm: [
      [{ rules: [{ action: 'allow', os: { name: 'windows' } }], value: ['-Dos.name=Windows 10'] }],
      ['-Djava.library.path=${natives_directory}'],
      ['-cp', '${classpath}'],
    ],
  },
}

/* ------------------------------------------------------------------ */
/* rules                                                               */
/* ------------------------------------------------------------------ */

describe('runtime/rules', () => {
  it('maps node platforms to Mojang names', () => {
    expect(osFromPlatform('win32')).toBe('windows')
    expect(osFromPlatform('darwin')).toBe('osx')
    expect(osFromPlatform('linux')).toBe('linux')
    expect(osFromPlatform('freebsd')).toBe('linux')
  })

  it('normalises architecture aliases', () => {
    expect(normalizeArch('x86_64')).toBe('x64')
    expect(normalizeArch('AMD64')).toBe('x64')
    expect(normalizeArch('aarch64')).toBe('arm64')
    expect(normalizeArch('i686')).toBe('x86')
    expect(normalizeArch('mips')).toBe('unknown')
    expect(archAliases('arm64')).toContain('aarch64')
  })

  it('detects the platform it runs on', () => {
    const platform = currentPlatform()
    expect(['windows', 'osx', 'linux']).toContain(platform.os)
    expect(platform.version.length).toBeGreaterThan(0)
  })

  it('treats a missing rule list as allowed', () => {
    expect(isAllowed(undefined, WINDOWS)).toBe(true)
    expect(isAllowed([], WINDOWS)).toBe(true)
  })

  it('defaults to disallow when nothing matches', () => {
    const rules = [{ action: 'allow' as const, os: { name: 'osx' } }]
    expect(isAllowed(rules, WINDOWS)).toBe(false)
    expect(isAllowed(rules, MAC_ARM)).toBe(true)
  })

  it('lets the last matching rule win', () => {
    const rules = [
      { action: 'allow' as const },
      { action: 'disallow' as const, os: { name: 'windows' } },
    ]
    expect(isAllowed(rules, WINDOWS)).toBe(false)
    expect(isAllowed(rules, LINUX)).toBe(true)
  })

  it('ignores features that are not requested', () => {
    const rules = [{ action: 'allow' as const, features: { has_custom_resolution: true } }]
    expect(isAllowed(rules, WINDOWS, {})).toBe(false)
    expect(isAllowed(rules, WINDOWS, { has_custom_resolution: true })).toBe(true)
    expect(resolveRuleAction(rules, WINDOWS, {})).toBeUndefined()
  })

  it('matches os.arch against the normalised architecture', () => {
    const rules = [{ action: 'allow' as const, os: { name: 'osx', arch: 'arm64' } }]
    expect(isAllowed(rules, MAC_ARM)).toBe(true)
    expect(isAllowed(rules, { ...MAC_ARM, arch: 'x64' })).toBe(false)
  })

  it('supports combined win-x86 style names', () => {
    const rules = [{ action: 'allow' as const, os: { name: 'win-x86' } }]
    expect(isAllowed(rules, { ...WINDOWS, arch: 'x86' })).toBe(true)
    expect(isAllowed(rules, WINDOWS)).toBe(false)
  })

  it('evaluates os.version regular expressions', () => {
    const rules = [{ action: 'allow' as const, os: { name: 'windows', version: '^10\\.' } }]
    expect(isAllowed(rules, WINDOWS)).toBe(true)
    expect(isAllowed(rules, { ...WINDOWS, version: '6.1' })).toBe(false)
  })

  it('does not blow up on an invalid version pattern', () => {
    const rules = [{ action: 'allow' as const, os: { version: '(' } }]
    expect(isAllowed(rules, WINDOWS)).toBe(false)
  })
})

/* ------------------------------------------------------------------ */
/* arguments                                                           */
/* ------------------------------------------------------------------ */

describe('runtime/arguments', () => {
  it('flattens nested argument groups', () => {
    expect(flattenArgumentGroups([['a', 'b'], ['c']])).toEqual(['a', 'b', 'c'])
  })

  it('expands known placeholders and keeps unknown ones', () => {
    expect(expandVariables('--username ${auth_player_name}', { '${auth_player_name}': 'Alex' }))
      .toBe('--username Alex')
    expect(expandVariables('${nope}', {})).toBe('${nope}')
  })

  it('filters ruled entries by rules', () => {
    const entry = { rules: [{ action: 'allow' as const, os: { name: 'osx' } }], value: ['-Xstart'] }
    expect(resolveArgumentEntry(entry, {}, {}, WINDOWS)).toEqual([])
    expect(resolveArgumentEntry(entry, {}, {}, MAC_ARM)).toEqual(['-Xstart'])
  })

  it('accepts both value and values', () => {
    expect(resolveArgumentEntry({ value: '--demo' } as never, {}, {}, WINDOWS)).toEqual(['--demo'])
    expect(resolveArgumentEntry({ values: ['--a', '--b'] } as never, {}, {}, WINDOWS)).toEqual(['--a', '--b'])
  })

  it('evaluates a whole group', () => {
    const groups = [
      ['--username', '${auth_player_name}'],
      [{ rules: [{ action: 'allow' as const, features: { is_demo_user: true } }], value: ['--demo'] }],
    ]
    expect(evaluateArguments(groups, { '${auth_player_name}': 'Steve' }, {}, WINDOWS))
      .toEqual(['--username', 'Steve'])
  })

  it('tokenizes legacy minecraftArguments strings', () => {
    expect(tokenizeArguments('--username a --gameDir "C:/a b/.minecraft"'))
      .toEqual(['--username', 'a', '--gameDir', 'C:/a b/.minecraft'])
    expect(tokenizeArguments(undefined)).toEqual([])
    expect(tokenizeArguments('  ')).toEqual([])
  })
})

/* ------------------------------------------------------------------ */
/* maven                                                               */
/* ------------------------------------------------------------------ */

describe('runtime/command maven paths', () => {
  it('parses plain coordinates', () => {
    expect(parseMaven('org.lwjgl:lwjgl:3.3.1')).toEqual({
      group: 'org.lwjgl', artifact: 'lwjgl', version: '3.3.1',
      classifier: undefined, extension: 'jar',
    })
  })

  it('parses classifiers and extensions', () => {
    const parsed = parseMaven('org.lwjgl:lwjgl:3.3.1:natives-windows@jar')
    expect(parsed.classifier).toBe('natives-windows')
    expect(parsed.extension).toBe('jar')
  })

  it('builds the maven layout', () => {
    expect(mavenPath('com.mojang:brigadier:1.0.18'))
      .toBe('com/mojang/brigadier/1.0.18/brigadier-1.0.18.jar')
    expect(mavenPath('org.lwjgl:lwjgl:3.3.1:natives-windows'))
      .toBe('org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar')
  })

  it('resolves the arch placeholder in natives classifiers', () => {
    expect(resolveNativesClassifier('natives-windows-${arch}', WINDOWS)).toBe('natives-windows-64')
    expect(resolveNativesClassifier('natives-windows-${arch}', { ...WINDOWS, arch: 'x86' }))
      .toBe('natives-windows-32')
    expect(resolveNativesClassifier('natives-windows', WINDOWS)).toBe('natives-windows')
  })
})

/* ------------------------------------------------------------------ */
/* planLibraries                                                       */
/* ------------------------------------------------------------------ */

describe('planLibraries', () => {
  const libraries = [
    {
      name: 'com.mojang:brigadier:1.0.18',
      downloads: { artifact: { url: 'https://x/a.jar', path: 'com/mojang/brigadier/1.0.18/brigadier-1.0.18.jar' } },
    },
    {
      name: 'org.lwjgl:lwjgl:3.3.1',
      downloads: { artifact: { url: 'https://x/lwjgl.jar', path: 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar' } },
      natives: { windows: 'natives-windows', linux: 'natives-linux', osx: 'natives-macos' },
    },
    { name: 'only.on.mac', rules: [{ action: 'allow' as const, os: { name: 'osx' } }] },
  ]

  it('keeps the classpath and separates natives', () => {
    const plans = planLibraries(libraries as never, WINDOWS, 'E:/libraries')
    const brigadier = plans.find((plan) => plan.name === 'com.mojang:brigadier:1.0.18')
    expect(brigadier?.classpath).toBe(true)
    expect(brigadier?.native).toBe(false)
    const natives = plans.filter((plan) => plan.native)
    expect(natives).toHaveLength(1)
    expect(natives[0].path).toContain('lwjgl-3.3.1-natives-windows.jar')
    expect(natives[0].exclude).toContain('META-INF/')
  })

  it('drops libraries whose rules do not match', () => {
    const plans = planLibraries(libraries as never, WINDOWS, 'E:/libraries')
    expect(plans.some((plan) => plan.name === 'only.on.mac')).toBe(false)
    const mac = planLibraries(libraries as never, MAC_ARM, 'E:/libraries')
    expect(mac.some((plan) => plan.name === 'only.on.mac')).toBe(true)
  })

  it('treats modern natives-* classifiers as native artifacts', () => {
    const plans = planLibraries([
      {
        name: 'org.lwjgl:lwjgl:3.3.1:natives-windows',
        downloads: { artifact: { url: 'https://x/n.jar', path: 'org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1-natives-windows.jar' } },
      },
    ] as never, WINDOWS, 'E:/libraries')
    expect(plans[0].native).toBe(true)
    expect(plans[0].classpath).toBe(false)
  })

  it('keeps the extract exclusions of the library', () => {
    const plans = planLibraries([
      { name: 'a:b:1', natives: { windows: 'natives-windows' }, extract: { exclude: ['META-INF/', 'foo/'] } },
    ] as never, WINDOWS, 'E:/libraries')
    expect(plans[0].exclude).toContain('foo/')
  })

  it('builds a classpath with the version jar last', () => {
    const plans = planLibraries([
      { name: 'a:b:1' },
      { name: 'c:d:2', natives: { windows: 'natives-windows' } },
    ] as never, WINDOWS, 'E:/libraries')
    const classpath = classpathFromPlans(plans, 'E:/versions/1.20.1/1.20.1.jar')
    expect(classpath).toHaveLength(2)
    expect(classpath[1]).toBe('E:/versions/1.20.1/1.20.1.jar')
  })
})

/* ------------------------------------------------------------------ */
/* buildCommand                                                        */
/* ------------------------------------------------------------------ */

describe('buildCommand', () => {
  it('builds a complete modern command line', () => {
    const built = buildCommand(baseInput(MODERN))
    expect(built.command[0]).toBe('C:/jdk/bin/java.exe')
    expect(built.mainClass).toBe('net.minecraft.client.main.Main')

    expect(built.jvmArgs).toContain('-Xmx4096m')
    expect(built.jvmArgs).toContain('-Xms1024m')
    expect(built.jvmArgs).toContain('-Dminecraft.launcher.brand=Rhine Launcher')
    expect(built.jvmArgs).toContain('-Dminecraft.launcher.version=0.1.0')
    expect(built.jvmArgs).toContain('-Dos.name=Windows 10')
    expect(built.jvmArgs).toContain('-Djava.library.path=E:/instances/test/natives')
    expect(built.jvmArgs).toContain('-cp')
    expect(built.jvmArgs).toContain('E:/libraries/a.jar;E:/libraries/b.jar;E:/versions/1.20.1/1.20.1.jar')

    expect(built.gameArgs).toEqual(expect.arrayContaining([
      '--username', 'Steve',
      '--uuid', '069a79f444e94726a5befca90e38aaf5',
      '--accessToken', 'token-123',
      '--userType', 'msa',
      '--version', '1.20.1',
      '--gameDir', 'E:/instances/test',
      '--assetsDir', 'E:/assets',
      '--assetIndex', '5',
      '--width', '1280',
      '--height', '720',
    ]))
    expect(built.gameArgs).not.toContain('--macOnlyArg')
    expect(built.command.indexOf('net.minecraft.client.main.Main')).toBeGreaterThan(1)
    expect(built.command).toEqual([built.command[0], ...built.jvmArgs.slice(), built.mainClass, ...built.gameArgs])
  })

  it('drops windows-only jvm args on other platforms and uses the alternate separator', () => {
    const built = buildCommand(baseInput(MODERN, {
      platform: MAC_ARM,
      pathSeparator: ':',
      classpath: ['E:/libraries/a.jar', 'E:/libraries/b.jar'],
    }))
    expect(built.jvmArgs).not.toContain('-Dos.name=Windows 10')
    expect(built.jvmArgs).toContain('E:/libraries/a.jar:E:/libraries/b.jar:E:/versions/1.20.1/1.20.1.jar')
    expect(built.gameArgs).toContain('--macOnlyArg')
  })

  it('omits the resolution when the window is 0x0', () => {
    const built = buildCommand(baseInput(MODERN, {
      instance: { ...INSTANCE, window: { width: 0, height: 0, fullscreen: false } },
    }))
    expect(built.gameArgs).not.toContain('--width')
  })

  it('adds --fullscreen and user arguments last', () => {
    const built = buildCommand(baseInput(MODERN, {
      instance: {
        ...INSTANCE,
        window: { width: 1280, height: 720, fullscreen: true },
        gameArgs: ['--demo'],
      },
      gameExtra: ['--server', 'example.org'],
    }))
    expect(built.gameArgs).toContain('--fullscreen')
    expect(built.gameArgs.indexOf('--server')).toBeGreaterThan(built.gameArgs.indexOf('--demo'))
  })

  it('supports legacy minecraftArguments versions', () => {
    const legacy: RawVersionJson = {
      id: '1.7.10',
      type: 'release',
      mainClass: 'net.minecraft.client.main.Main',
      minecraftArguments: '--username ${auth_player_name} --session ${auth_session} --version ${version_name} --gameDir ${game_directory} --assetsDir ${assets_root} --uuid ${auth_uuid} --accessToken ${auth_access_token} --userProperties ${user_properties} --assetIndex ${assets_index_name}',
      assets: 'legacy',
    }
    const built = buildCommand(baseInput(legacy))
    expect(built.jvmArgs).toContain('-Djava.library.path=E:/instances/test/natives')
    expect(built.jvmArgs).toContain('-cp')
    expect(built.gameArgs).toEqual(expect.arrayContaining([
      '--username', 'Steve',
      '--uuid', '069a79f444e94726a5befca90e38aaf5',
      '--userProperties', '{}',
      '--assetIndex', 'legacy',
      '--width', '1280',
    ]))
  })

  it('injects auth arguments that the version json forgot', () => {
    const stripped: RawVersionJson = { id: 'x', mainClass: 'a.B', arguments: { game: [['--demo']] } }
    const built = buildCommand(baseInput(stripped))
    expect(built.gameArgs).toEqual(expect.arrayContaining([
      '--username', 'Steve',
      '--uuid', '069a79f444e94726a5befca90e38aaf5',
      '--accessToken', 'token-123',
      '--gameDir', 'E:/instances/test',
    ]))
  })

  it('expands the log4j configuration argument', () => {
    const version: RawVersionJson = {
      ...MODERN,
      logging: {
        client: {
          argument: '-Dlog4j.configurationFile=${path}',
          file: { id: 'client-1.12.xml', url: 'https://x/log4j.xml' },
        },
      },
    }
    const built = buildCommand(baseInput(version, { loggingFile: 'E:/instances/test/.rhine/log4j2.xml' }))
    expect(built.jvmArgs).toContain('-Dlog4j.configurationFile=E:/instances/test/.rhine/log4j2.xml')
  })

  it('honours memory overrides', () => {
    const built = buildCommand(baseInput(MODERN, { memory: { minMb: 512, maxMb: 8192 } }))
    expect(built.jvmArgs).toContain('-Xmx8192m')
    expect(built.jvmArgs).toContain('-Xms512m')
  })

  it('does not emit -Xms above -Xmx', () => {
    const built = buildCommand(baseInput(MODERN, { memory: { minMb: 8192, maxMb: 2048 } }))
    expect(built.jvmArgs).toContain('-Xmx2048m')
    expect(built.jvmArgs).not.toContain('-Xms8192m')
  })

  it('appends the version jar to an explicit classpath only once', () => {
    const built = buildCommand(baseInput(MODERN, {
      classpath: ['E:/libraries/a.jar', 'E:/versions/1.20.1/1.20.1.jar'],
    }))
    expect(built.classpath.filter((entry) => entry === 'E:/versions/1.20.1/1.20.1.jar')).toHaveLength(1)
  })
})

describe('sanitiseJvmArgs', () => {
  it('drops flags newer JVMs reject', () => {
    const args = ['-Xincgc', '-XX:+UseConcMarkSweepGC', '--illegal-access=permit', '-Xmx1g']
    expect(sanitiseJvmArgs(args, 8)).toEqual(args)
    expect(sanitiseJvmArgs(args, 17)).toEqual(['-Xmx1g'])
  })
})

describe('ensureAuthArguments', () => {
  it('appends only missing flags', () => {
    const args = ['--username', 'x']
    ensureAuthArguments(args, { '${auth_player_name}': 'Steve', '${auth_uuid}': 'u' })
    expect(args.filter((arg) => arg === '--username')).toHaveLength(1)
    expect(args).toContain('--uuid')
  })
})

describe('defaultGameArguments', () => {
  it('only applies when a custom resolution is used', () => {
    const groups = defaultGameArguments()
    expect(evaluateArguments(groups, { '${resolution_width}': '800', '${resolution_height}': '600' }, {}, WINDOWS)).toEqual([])
    expect(evaluateArguments(groups, { '${resolution_width}': '800', '${resolution_height}': '600' }, { has_custom_resolution: true }, WINDOWS))
      .toEqual(['--width', '800', '--height', '600'])
  })
})
