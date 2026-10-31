/**
 * Pure command line construction for a Minecraft launch.
 *
 * Everything here is deterministic: no IO, no network, no process. The
 * {@link LaunchService} resolves the version json, downloads the files and
 * extracts the natives, then calls {@link buildCommand} with absolute paths.
 * Keeping it pure makes the whole argument pipeline unit testable.
 */
import { delimiter, join } from 'node:path'
import type { RawLibrary, RawVersionJson } from '../contracts.ts'
import type { InstanceConfig } from '../types.ts'
import {
  evaluateArguments, expandArgumentList, expandVariables, tokenizeArguments,
  type ArgumentGroups, type ArgumentVariables,
} from './arguments.ts'
import { isAllowed, type PlatformInfo } from './rules.ts'

/** One library after rule filtering, with the local file it maps to. */
export interface LibraryPlan {
  /** Maven coordinate as written in the version json. */
  name: string
  /** Absolute path of the jar on disk. */
  path: string
  /** Relative (POSIX) path inside the libraries directory. */
  relative: string
  /** Download URL when the library declares one. */
  url?: string
  sha1?: string
  size?: number
  /** True when the jar belongs on the classpath. */
  classpath: boolean
  /** True when the jar must be extracted into the natives directory. */
  native: boolean
  /** Prefixes that must not be extracted (META-INF/ is always excluded). */
  exclude: string[]
}

/** Authenticated player passed to the game. */
export interface LaunchAuth {
  username: string
  /** Undashed UUID, as required by `--uuid`. */
  uuid: string
  accessToken: string
  userType?: string
  clientId?: string
  xuid?: string
  /** Extra `--userProperties` payload; defaults to `{}`. */
  userProperties?: string
}

/** Everything {@link buildCommand} needs. */
export interface BuildCommandInput {
  /** Merged version json (inheritsFrom already resolved). */
  version: RawVersionJson
  /** Display name used for `--version`. */
  versionName?: string
  instance: InstanceConfig
  /** Absolute instance (= `.minecraft`) directory. */
  gameDir: string
  /** Absolute assets dir. */
  assetsDir: string
  /** Absolute libraries dir. */
  librariesDir: string
  /** Absolute classpath entries, in order; natives must already be excluded. */
  classpath?: string[]
  /** Absolute path of the version jar, appended to the classpath. */
  versionJar?: string
  /** Absolute natives directory. */
  nativesDir: string
  javaPath: string
  javaMajor: number
  memory?: { minMb: number; maxMb: number }
  window?: { width: number; height: number; fullscreen: boolean }
  /** Extra JVM arguments appended before the version's own jvm arguments. */
  jvmExtra?: string[]
  /** Extra game arguments appended last. */
  gameExtra?: string[]
  auth: LaunchAuth
  launcher?: { name: string; version: string }
  /** Downloaded log4j configuration file; omitted for pre-1.7 versions. */
  loggingFile?: string
  platform: PlatformInfo
  pathSeparator?: string
  /** Version type placeholder, e.g. `release`. */
  versionType?: string
  /** Feature flags used by modern `arguments` rules. */
  features?: Record<string, boolean>
}

/** Result of {@link buildCommand}. */
export interface BuiltCommand {
  /** Full argv, including the java executable at index 0. */
  command: string[]
  mainClass: string
  jvmArgs: string[]
  gameArgs: string[]
  classpath: string[]
  nativesDir: string
}

/** Default launcher brand used for `-Dminecraft.launcher.brand`. */
export const LAUNCHER_BRAND = 'Rhine Launcher'
/** Default launcher version used for `-Dminecraft.launcher.version`. */
export const LAUNCHER_VERSION = '0.1.0'

/** Prefixes never extracted from a natives jar. */
export const NATIVE_EXCLUDES = ['META-INF/']

/**
 * Split a maven coordinate into its parts.
 *
 * Accepts `group:artifact:version`, an optional 4th classifier and an optional
 * `@extension` suffix (Forge uses both).
 */
export function parseMaven(name: string): {
  group: string
  artifact: string
  version: string
  classifier?: string
  extension: string
} {
  const [coords, extension] = splitExtension(name)
  const parts = coords.split(':')
  return {
    group: parts[0] ?? '',
    artifact: parts[1] ?? '',
    version: parts[2] ?? '',
    classifier: parts[3],
    extension,
  }
}

function splitExtension(name: string): [string, string] {
  const at = name.indexOf('@')
  if (at < 0) return [name, 'jar']
  return [name.slice(0, at), name.slice(at + 1) || 'jar']
}

/** Relative maven path of a coordinate, e.g. `org/lwjgl/lwjgl/3.3.1/lwjgl-3.3.1.jar`. */
export function mavenPath(name: string): string {
  const { group, artifact, version, classifier, extension } = parseMaven(name)
  const suffix = classifier ? '-' + classifier : ''
  const file = artifact + '-' + version + suffix + '.' + extension
  return group.replace(/\./g, '/') + '/' + artifact + '/' + version + '/' + file
}

/** Placeholder Mojang uses inside a natives classifier for the architecture. */
const ARCH_PLACEHOLDER = '$' + '{arch}'

/** Replace the arch placeholder in a natives classifier (`natives-windows-${arch}`). */
export function resolveNativesClassifier(classifier: string, platform: PlatformInfo): string {
  const arch = platform.arch === 'x86' ? '32' : platform.arch === 'x64' ? '64' : platform.arch
  return classifier.split(ARCH_PLACEHOLDER).join(arch)
}

/** Mojang key used in `natives` maps (`windows`, `osx`, `linux`). */
export function nativesOsKey(platform: PlatformInfo): string {
  return platform.os
}

/**
 * Plan every library of a version json.
 *
 * Rules are evaluated first, then legacy `natives` maps and modern
 * `natives-<os>` classifiers are separated from the classpath.
 */
export function planLibraries(
  libraries: RawLibrary[] | undefined,
  platform: PlatformInfo,
  librariesDir: string,
  features: Record<string, boolean> = {},
): LibraryPlan[] {
  const plans: LibraryPlan[] = []
  const seen = new Set<string>()

  for (const library of libraries ?? []) {
    if (!library || typeof library.name !== 'string') continue
    if (!isAllowed(library.rules, platform, features)) continue

    const exclude = [...NATIVE_EXCLUDES, ...(library.extract?.exclude ?? [])]
    const osKey = nativesOsKey(platform)
    const nativesField = library.natives
    const nativeClassifier = nativesField?.[osKey]
      ?? (osKey === 'osx' ? nativesField?.macos : undefined)

    if (nativeClassifier) {
      const classifier = resolveNativesClassifier(nativeClassifier, platform)
      const info = library.downloads?.classifiers?.[classifier]
      const relative = info?.path ?? mavenPath(library.name + ':' + classifier)
      const path = join(librariesDir, ...relative.split('/'))
      if (seen.has(path)) continue
      seen.add(path)
      plans.push({
        name: library.name + ':' + classifier,
        path,
        relative,
        url: info?.url,
        sha1: info?.sha1,
        size: info?.size,
        classpath: false,
        native: true,
        exclude,
      })
      continue
    }

    const parsed = parseMaven(library.name)
    const isModernNative = !!parsed.classifier && parsed.classifier.startsWith('natives')
    const artifact = library.downloads?.artifact
    const relative = artifact?.path ?? mavenPath(library.name)
    const path = join(librariesDir, ...relative.split('/'))
    if (seen.has(path)) continue
    seen.add(path)

    plans.push({
      name: library.name,
      path,
      relative,
      url: artifact?.url ?? (library.url ? joinUrl(library.url, relative) : undefined),
      sha1: artifact?.sha1,
      size: artifact?.size,
      classpath: !isModernNative,
      native: isModernNative,
      exclude,
    })
  }

  return plans
}

function joinUrl(base: string, relative: string): string {
  const trimmed = base.endsWith('/') ? base.slice(0, -1) : base
  return trimmed + '/' + relative.split('/').map(encodeURIComponent).join('/')
}

/** Build the placeholders shared by `arguments.jvm` and `arguments.game`. */
export function buildVariables(
  input: BuildCommandInput,
  classpath: string[],
  separator: string,
): ArgumentVariables {
  const versionName = input.versionName ?? input.version.id
  const window = input.window ?? input.instance.window
  return {
    '${auth_player_name}': input.auth.username,
    '${auth_session}': input.auth.accessToken,
    '${auth_access_token}': input.auth.accessToken,
    '${auth_uuid}': input.auth.uuid,
    '${auth_xuid}': input.auth.xuid ?? '',
    '${user_type}': input.auth.userType ?? 'msa',
    '${user_properties}': input.auth.userProperties ?? '{}',
    '${clientid}': input.auth.clientId ?? '',
    '${version_name}': versionName,
    '${version_type}': input.versionType ?? input.version.type ?? 'release',
    '${profile_name}': versionName,
    '${game_directory}': input.gameDir,
    '${game_assets}': input.assetsDir,
    '${assets_root}': input.assetsDir,
    '${assets_index_name}': input.version.assetIndex?.id ?? input.version.assets ?? 'legacy',
    '${classpath}': classpath.join(separator),
    '${classpath_separator}': separator,
    '${natives_directory}': input.nativesDir,
    '${library_directory}': input.librariesDir,
    '${libraries_directory}': input.librariesDir,
    '${primary_jar}': input.versionJar ?? '',
    '${launcher_name}': input.launcher?.name ?? LAUNCHER_BRAND,
    '${launcher_version}': input.launcher?.version ?? LAUNCHER_VERSION,
    '${resolution_width}': String(window.width),
    '${resolution_height}': String(window.height),
    '${file_separator}': separator === ';' ? '\\' : '/',
  }
}

/** Arguments every pre-1.13 version needs but does not declare itself. */
export function defaultJvmArguments(): string[] {
  return [
    '-Djava.library.path=${natives_directory}',
    '-Dminecraft.launcher.brand=${launcher_name}',
    '-Dminecraft.launcher.version=${launcher_version}',
    '-cp',
    '${classpath}',
  ]
}

/** Arguments the legacy launcher added for custom resolutions. */
export function defaultGameArguments(): ArgumentGroups {
  return [[{
    rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
    value: ['--width', '${resolution_width}', '--height', '${resolution_height}'],
  }]]
}

/** Compute the classpath list from library plans plus the version jar. */
export function classpathFromPlans(plans: LibraryPlan[], versionJar?: string): string[] {
  const entries = plans.filter((plan) => plan.classpath).map((plan) => plan.path)
  if (versionJar) entries.push(versionJar)
  return dedupe(entries)
}

function dedupe(values: string[]): string[] {
  return [...new Set(values)]
}

function classpathContains(values: string[] | undefined, entry: string): boolean {
  return (values ?? []).includes(entry)
}

/**
 * Assemble the full Java command line.
 *
 * Ordering follows the official launcher and HMCL: java → memory → launcher
 * brand → log4j → user jvm args → version jvm arguments → main class → game
 * arguments → window options → user game arguments.
 */
export function buildCommand(input: BuildCommandInput): BuiltCommand {
  const platform = input.platform
  const separator = input.pathSeparator ?? delimiter
  const window = input.window ?? input.instance.window
  const memory = input.memory ?? input.instance.memory
  const features: Record<string, boolean> = {
    has_custom_resolution: window.width > 0 && window.height > 0,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
    is_demo_user: false,
    ...input.features,
  }

  const classpath = dedupe(input.classpath ?? [])
    .concat(input.versionJar && !classpathContains(input.classpath, input.versionJar) ? [input.versionJar] : [])
  const variables = buildVariables(input, classpath, separator)
  const mainClass = input.version.mainClass ?? 'net.minecraft.client.main.Main'

  const jvmArgs: string[] = []
  if (memory?.maxMb > 0) jvmArgs.push('-Xmx' + memory.maxMb + 'm')
  if (memory?.minMb > 0 && (!memory.maxMb || memory.minMb <= memory.maxMb)) {
    jvmArgs.push('-Xms' + memory.minMb + 'm')
  }
  jvmArgs.push('-Dminecraft.launcher.brand=' + (input.launcher?.name ?? LAUNCHER_BRAND))
  jvmArgs.push('-Dminecraft.launcher.version=' + (input.launcher?.version ?? LAUNCHER_VERSION))
  if (input.loggingFile) {
    const template = input.version.logging?.client?.argument ?? '-Dlog4j.configurationFile=${path}'
    jvmArgs.push(expandVariables(template.split('${path}').join(input.loggingFile), variables))
  }
  jvmArgs.push(...(input.instance.jvmArgs ?? []), ...(input.jvmExtra ?? []))

  const declaredJvm = input.version.arguments?.jvm
  const evaluatedJvm = declaredJvm && declaredJvm.length > 0
    ? evaluateArguments(declaredJvm, variables, features, platform)
    : expandArgumentList(defaultJvmArguments(), variables)
  jvmArgs.push(...evaluatedJvm)

  const gameArgs: string[] = []
  if (input.version.arguments?.game) {
    gameArgs.push(...evaluateArguments(input.version.arguments.game, variables, features, platform))
  } else if (input.version.minecraftArguments) {
    gameArgs.push(...expandArgumentList(tokenizeArguments(input.version.minecraftArguments), variables))
    gameArgs.push(...evaluateArguments(defaultGameArguments(), variables, features, platform))
  }

  ensureAuthArguments(gameArgs, variables)
  if (window.width > 0 && window.height > 0 && !gameArgs.includes('--width')) {
    gameArgs.push('--width', String(window.width), '--height', String(window.height))
  }
  if (window.fullscreen && !gameArgs.includes('--fullscreen')) gameArgs.push('--fullscreen')
  gameArgs.push(...(input.instance.gameArgs ?? []), ...(input.gameExtra ?? []))

  const cleanedJvm = sanitiseJvmArgs(jvmArgs, input.javaMajor)
  const command = [input.javaPath, ...cleanedJvm, mainClass, ...gameArgs.filter(Boolean)]

  return { command, mainClass, jvmArgs: cleanedJvm, gameArgs, classpath, nativesDir: input.nativesDir }
}

/**
 * Drop default JVM arguments that the selected runtime rejects.
 *
 * Legacy profiles commonly embed `-Xincgc` (removed in Java 9) and
 * `--illegal-access` flags that Java 17+ refuses to start with.
 */
export function sanitiseJvmArgs(args: string[], javaMajor: number): string[] {
  return args.filter((arg) => {
    if (javaMajor >= 9 && arg === '-Xincgc') return false
    if (javaMajor >= 9 && arg.startsWith('-XX:+UseConcMarkSweepGC')) return false
    if (javaMajor >= 17 && arg.startsWith('--illegal-access')) return false
    if (javaMajor >= 21 && arg.startsWith('-XX:MaxPermSize')) return false
    return true
  })
}

/** Append auth arguments that an older version json forgot to declare. */
export function ensureAuthArguments(gameArgs: string[], variables: ArgumentVariables): void {
  const pairs: [string, string][] = [
    ['--username', '${auth_player_name}'],
    ['--uuid', '${auth_uuid}'],
    ['--accessToken', '${auth_access_token}'],
    ['--userType', '${user_type}'],
    ['--version', '${version_name}'],
    ['--gameDir', '${game_directory}'],
    ['--assetsDir', '${assets_root}'],
    ['--assetIndex', '${assets_index_name}'],
  ]
  for (const [flag, key] of pairs) {
    if (!gameArgs.includes(flag)) gameArgs.push(flag, variables[key] ?? '')
  }
}
