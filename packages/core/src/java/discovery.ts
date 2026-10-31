/**
 * Java runtime discovery helpers.
 *
 * Locating a JRE has two halves: guessing plausible install locations
 * (platform roots, `JAVA_HOME`, `PATH`) and parsing what the probe writes to
 * stderr. Both are pure so they can be unit tested on any machine, while the
 * service owns process spawning and the cache.
 */
import { join } from 'node:path'
import type { JavaRuntime } from '../types.ts'

/** Normalised architecture understood by {@link JavaRuntime}. */
export type JavaArch = JavaRuntime['arch']

/** Where a candidate executable came from; drives ordering and diagnostics. */
export type JavaCandidateSource = 'managed' | 'java_home' | 'path' | 'common'

/** One executable the scanner wants to probe. */
export interface JavaCandidate {
  /** Absolute path of `bin/java(.exe)`. */
  path: string
  /** True when the runtime lives under `<root>/java` (downloaded by the launcher). */
  managed: boolean
  source: JavaCandidateSource
}

/** Everything a probe teaches us about one JVM. */
export interface JavaProbeResult {
  /** Full version, e.g. `17.0.15` or `1.8.0_402`. */
  version: string
  vendor: string
  arch: JavaArch
}

/** Only the environment variables the discovery rules look at. */
export interface JavaEnvironment {
  JAVA_HOME?: string
  PATH?: string
  USERPROFILE?: string
  LOCALAPPDATA?: string
  ProgramFiles?: string
  'ProgramFiles(x86)'?: string
}

/** Platform specific name of the java launcher. */
export function javaExecutableName(platform: NodeJS.Platform = process.platform): string {
  return platform === 'win32' ? 'java.exe' : 'java'
}

/** Absolute `bin/java(.exe)` path inside a JAVA_HOME style directory. */
export function javaExecutableIn(home: string, platform: NodeJS.Platform = process.platform): string {
  return join(home, 'bin', javaExecutableName(platform))
}

/**
 * De-duplication key for an executable path.
 *
 * Windows is case insensitive, so two spellings of the same java.exe must not
 * be probed (or listed) twice.
 */
export function javaPathKey(path: string, platform: NodeJS.Platform = process.platform): string {
  const normalised = path.replace(/[\\/]+/g, '/')
  return platform === 'win32' ? normalised.toLowerCase() : normalised
}

/**
 * Major version of a Java version string.
 *
 * Handles the legacy `1.8.0_402` scheme as well as the modern `21.0.1+12`.
 *
 * @returns the major version (8/17/21/25...), or 0 when the string is unusable.
 */
export function javaMajorVersion(version: string | undefined): number {
  const text = (version ?? '').trim()
  if (!text) return 0
  if (text.startsWith('1.')) {
    const minor = Number.parseInt(text.slice(2).split(/[._+\-]/)[0] ?? '', 10)
    return Number.isFinite(minor) && minor > 0 ? minor : 0
  }
  const major = Number.parseInt(text.split(/[._+\-]/)[0] ?? '', 10)
  return Number.isFinite(major) && major > 0 ? major : 0
}

/** Map a JVM `os.arch` value to the launcher's normalised architecture. */
export function normalizeJavaArch(value: string | undefined): JavaArch {
  const text = (value ?? '').toLowerCase().replace(/[\s_-]/g, '')
  if (!text) return 'unknown'
  if (text === 'amd64' || text === 'x8664' || text === 'x64' || text === 'em64t') return 'x64'
  if (text === 'aarch64' || text === 'arm64' || text === 'armv8' || text === 'arm864') return 'arm64'
  if (text === 'x86' || text === 'i386' || text === 'i486' || text === 'i586' || text === 'i686' || text === 'ia32' || text === 'x8632') {
    return 'x86'
  }
  return 'unknown'
}

/** Read one `key = value` pair out of a JVM property dump. */
export function javaProperty(output: string, key: string): string | undefined {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = new RegExp('^[ \\t]*' + escaped + '[ \\t]*=[ \\t]*(.+?)[ \\t]*$', 'm').exec(output)
  const value = match?.[1]?.trim()
  return value ? value : undefined
}

/**
 * Parse `java -XshowSettings:properties -version` output.
 *
 * The JVM writes properties to stderr, one `key = value` per line, followed
 * by the usual version banner.
 *
 * @returns the parsed values, or `undefined` when the dump is missing.
 */
export function parseJavaProperties(output: string): JavaProbeResult | undefined {
  const version = javaProperty(output, 'java.version')
  if (!version) return undefined
  return {
    version,
    vendor: javaProperty(output, 'java.vendor') ?? javaProperty(output, 'java.runtime.name') ?? 'Unknown',
    arch: normalizeJavaArch(javaProperty(output, 'os.arch')),
  }
}

/**
 * Parse a plain `java -version` banner.
 *
 * Used when `-XshowSettings` is unavailable (very old or wrapped JVMs):
 * `openjdk version "25.0.2" 2025-07-15`.
 */
export function parseJavaVersionBanner(output: string): JavaProbeResult | undefined {
  const match = /version\s+"([^"]+)"/.exec(output)
  if (!match) return undefined
  const version = match[1].trim()
  if (!version) return undefined
  return { version, vendor: bannerVendor(output), arch: 'unknown' }
}

/** Best effort vendor detection for a plain version banner. */
function bannerVendor(output: string): string {
  const header = output.split(/\r?\n/).find((line) => /version\s+"/.test(line))?.trim() ?? ''
  if (/graalvm/i.test(output)) return 'GraalVM'
  if (/zulu/i.test(output)) return 'Azul Zulu'
  if (/corretto/i.test(output)) return 'Amazon Corretto'
  if (/temurin|adoptium/i.test(output)) return 'Eclipse Adoptium'
  if (/^openjdk\b/i.test(header)) return 'OpenJDK'
  if (/^java\b/i.test(header)) return 'Oracle'
  return 'Unknown'
}

/**
 * Parse any probe output: prefer the property dump, fall back to the banner.
 *
 * @param output — combined stdout + stderr of the probe command.
 */
export function parseJavaProbe(output: string): JavaProbeResult | undefined {
  const properties = parseJavaProperties(output)
  const banner = parseJavaVersionBanner(output)
  if (!properties && !banner) return undefined
  const arch = properties?.arch && properties.arch !== 'unknown' ? properties.arch : banner?.arch ?? 'unknown'
  return {
    version: properties?.version ?? banner!.version,
    vendor: properties?.vendor ?? banner!.vendor,
    arch,
  }
}

/** Split a `PATH` value into candidate directories. */
export function pathEntries(value: string | undefined, platform: NodeJS.Platform = process.platform): string[] {
  if (!value) return []
  const separator = platform === 'win32' ? ';' : ':'
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of value.split(separator)) {
    const entry = raw.trim().replace(/^"(.*)"$/, '$1')
    if (!entry) continue
    const key = javaPathKey(entry, platform)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(entry)
  }
  return out
}

/**
 * Well-known parent directories that hold JRE/JDK installations.
 *
 * Only the containers are returned: the scanner lists their children and
 * looks for a `bin/java(.exe)` inside each one.
 */
export function commonJavaRoots(
  env: JavaEnvironment = process.env,
  platform: NodeJS.Platform = process.platform,
): string[] {
  if (platform === 'win32') {
    const programFiles = env.ProgramFiles?.trim() || 'C:\\Program Files'
    const programFilesX86 = env['ProgramFiles(x86)']?.trim() || 'C:\\Program Files (x86)'
    const localAppData = env.LOCALAPPDATA?.trim()
    const userProfile = env.USERPROFILE?.trim()
    const roots = [
      join(programFiles, 'Java'),
      join(programFiles, 'Eclipse Adoptium'),
      join(programFiles, 'Eclipse Foundation'),
      join(programFiles, 'Zulu'),
      join(programFiles, 'Microsoft'),
      join(programFiles, 'GraalVM'),
      join(programFiles, 'Amazon Corretto'),
      join(programFiles, 'BellSoft'),
      join(programFiles, 'Semeru'),
      join(programFiles, 'JetBrains'),
      join(programFiles, 'Android', 'Android Studio', 'jbr'),
      join(programFilesX86, 'Java'),
      join(programFilesX86, 'Eclipse Adoptium'),
      join(programFilesX86, 'Zulu'),
    ]
    if (localAppData) {
      roots.push(
        join(localAppData, 'Programs', 'Eclipse Adoptium'),
        join(localAppData, 'Programs', 'Zulu'),
        join(localAppData, 'Programs', 'Microsoft'),
        join(localAppData, 'Programs', 'GraalVM'),
      )
    }
    if (userProfile) {
      roots.push(
        join(userProfile, '.jdks'),
        join(userProfile, '.sdkman', 'candidates', 'java'),
        join(userProfile, 'scoop', 'apps', 'openjdk'),
      )
    }
    return roots
  }
  if (platform === 'darwin') {
    return [
      '/Library/Java/JavaVirtualMachines',
      '/System/Library/Java/JavaVirtualMachines',
      '/opt/homebrew/opt',
      '/usr/local/opt',
    ]
  }
  return ['/usr/lib/jvm', '/usr/java', '/opt/java', '/opt/jdk', '/usr/local/lib/jvm']
}

/**
 * Drive roots worth listing for a JDK unpacked at the top level.
 *
 * HMCL scans for `D:\\graalvm-jdk-25` style folders; on Windows the launcher
 * mirrors that by looking at each drive root and filtering by {@link looksLikeJavaDirectory}.
 */
export function commonJavaScanRoots(platform: NodeJS.Platform = process.platform): string[] {
  if (platform !== 'win32') return []
  return ['C:\\', 'D:\\', 'E:\\', 'F:\\']
}

/** True when a directory name looks like an unpacked JDK/JRE folder. */
export function looksLikeJavaDirectory(name: string): boolean {
  const text = (name ?? '').trim()
  if (!text) return false
  if (/^(jdk|jre|java|openjdk|graalvm|zulu|corretto|temurin|liberica|semeru|sapmachine|dragonwell|jbr|jetbrains)/i.test(text)) {
    return true
  }
  return /(jdk|jre|graalvm|corretto|zulu|temurin|liberica|semeru)[-_ ]?\d/i.test(text)
}

/** Order runtimes for display: newest major first, managed runtimes first on ties. */
export function sortJavaRuntimes(runtimes: JavaRuntime[]): JavaRuntime[] {
  return [...runtimes].sort((left, right) => {
    if (right.majorVersion !== left.majorVersion) return right.majorVersion - left.majorVersion
    if (left.managed !== right.managed) return left.managed ? -1 : 1
    return left.path.localeCompare(right.path)
  })
}

/** Drop duplicate executables, keeping the first occurrence (highest trust wins). */
export function dedupeJavaRuntimes(
  runtimes: JavaRuntime[],
  platform: NodeJS.Platform = process.platform,
): JavaRuntime[] {
  const seen = new Set<string>()
  const out: JavaRuntime[] = []
  for (const runtime of runtimes) {
    if (!runtime?.path) continue
    const key = javaPathKey(runtime.path, platform)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(runtime)
  }
  return out
}

/**
 * Pick a runtime for a required major version.
 *
 * Order: the user's pinned path, then an exact major match, then the closest
 * higher major, and finally any runtime (HMCL behaves the same way, letting
 * the game report an incompatible JVM instead of refusing to launch).
 *
 * @param runtimes — already discovered runtimes.
 * @param majorVersion — major version the version json asks for.
 * @param preferred — optional absolute executable path the user pinned.
 */
export function pickJavaRuntime(
  runtimes: JavaRuntime[],
  majorVersion: number,
  preferred?: string,
): JavaRuntime | undefined {
  if (!runtimes.length) return undefined
  if (preferred) {
    const key = javaPathKey(preferred)
    const pinned = runtimes.find((runtime) => javaPathKey(runtime.path) === key)
    if (pinned) return pinned
  }
  const required = Number.isFinite(majorVersion) && majorVersion > 0 ? Math.round(majorVersion) : 8
  const ordered = [...runtimes].sort((left, right) => left.majorVersion - right.majorVersion)
  const exact = ordered.find((runtime) => runtime.majorVersion === required)
  if (exact) return exact
  const higher = ordered.find((runtime) => runtime.majorVersion > required)
  if (higher) return higher
  // Nothing new enough: hand back the closest (highest) runtime available.
  return ordered[ordered.length - 1]
}
