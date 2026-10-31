/**
 * Pure helpers for the Java runtime page.
 *
 * The backend owns scanning; this module ranks, groups and validates runtimes
 * so the UI can recommend a sensible default like HMCL does.
 */
import type { JavaRuntime } from '@rhine/core'

/** Java versions relevant to modern Minecraft, newest first. */
export const JAVA_MAJORS = [25, 21, 17, 16, 11, 8] as const

/** Mojang runtime components by required major version. */
export const JAVA_COMPONENTS: { major: number; component: string; label: string }[] = [
  { major: 25, component: 'java-runtime-delta', label: 'Java 25（1.21.9+）' },
  { major: 21, component: 'java-runtime-gamma', label: 'Java 21（1.20.5+）' },
  { major: 17, component: 'java-runtime-beta', label: 'Java 17（1.18 - 1.20.4）' },
  { major: 8, component: 'jre-legacy', label: 'Java 8（1.16.5 及更早）' },
]

/** Chinese label for the architecture. */
export function archLabel(arch: JavaRuntime['arch']): string {
  switch (arch) {
    case 'x64': return '64 位'
    case 'arm64': return 'ARM64'
    case 'x86': return '32 位'
    default: return '未知架构'
  }
}

/** Sort runtimes: managed first, then newest major, then path. */
export function sortRuntimes(runtimes: JavaRuntime[]): JavaRuntime[] {
  return [...runtimes].sort((a, b) => {
    if (a.managed !== b.managed) return a.managed ? -1 : 1
    if (a.majorVersion !== b.majorVersion) return b.majorVersion - a.majorVersion
    return a.path.localeCompare(b.path)
  })
}

/**
 * Pick the best runtime for a required major version.
 *
 * Prefers an exact major match; when several exist, prefers the managed one so
 * automatic downloads are used before the user's system JRE.
 */
export function bestRuntime(
  runtimes: JavaRuntime[],
  requiredMajor: number,
  preferredPath?: string,
): JavaRuntime | undefined {
  if (preferredPath) {
    const pinned = runtimes.find((runtime) => runtime.path === preferredPath)
    if (pinned) return pinned
  }
  const exact = runtimes.filter((runtime) => runtime.majorVersion === requiredMajor)
  if (exact.length) {
    return exact.find((runtime) => runtime.managed) ?? exact[0]
  }
  // Fall back to the newest runtime at least as new as required: newer runtimes
  // can run older game versions but not the reverse.
  const newer = runtimes.filter((runtime) => runtime.majorVersion > requiredMajor)
  if (newer.length) {
    newer.sort((a, b) => a.majorVersion - b.majorVersion)
    const managed = newer.find((runtime) => runtime.managed)
    return managed ?? newer[0]
  }
  return undefined
}

/** Group runtimes by major version for the list header. */
export function groupByMajor(runtimes: JavaRuntime[]): { major: number; items: JavaRuntime[] }[] {
  const map = new Map<number, JavaRuntime[]>()
  for (const runtime of runtimes) {
    const list = map.get(runtime.majorVersion) ?? []
    list.push(runtime)
    map.set(runtime.majorVersion, list)
  }
  return [...map.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([major, items]) => ({ major, items: sortRuntimes(items) }))
}

/** Short vendor name for the table. */
export function vendorLabel(vendor: string): string {
  const value = vendor.trim()
  if (!value) return '未知厂商'
  return value
}

/** Validate a manually entered java executable path. */
export function validateJavaPath(path: string): string | undefined {
  const value = path.trim()
  if (!value) return '请填写 java 可执行文件路径'
  if (value.length < 3) return '路径过短，请填写完整路径'
  if (!/[/\\]/.test(value)) return '请填写完整路径（包含目录分隔符）'
  return undefined
}

/** Default component for a required major version. */
export function componentForMajor(major: number): string {
  const exact = JAVA_COMPONENTS.find((item) => item.major === major)
  if (exact) return exact.component
  if (major >= 25) return 'java-runtime-delta'
  if (major >= 21) return 'java-runtime-gamma'
  if (major >= 17) return 'java-runtime-beta'
  return 'jre-legacy'
}

/** Header counters. */
export function summarizeRuntimes(runtimes: JavaRuntime[]): {
  total: number
  managed: number
  majors: number[]
} {
  const majors = [...new Set(runtimes.map((runtime) => runtime.majorVersion))].sort((a, b) => b - a)
  return {
    total: runtimes.length,
    managed: runtimes.filter((runtime) => runtime.managed).length,
    majors,
  }
}
/**
 * Required Java major version for a Minecraft version string.
 *
 * Mirrors Mojang's runtime metadata: the required major is pinned per game
 * version, and the 2026-era numbering (26.x) moved to Java 25. Loaders do not
 * change the requirement in practice, so they only act as a tiebreaker for
 * unknown version shapes.
 *
 * @param gameVersion — e.g. "1.20.1", "1.21.4" or "26.3".
 * @returns the major version the game needs (falls back to 21).
 */
export function requiredJavaMajor(gameVersion: string): number {
  const parsed = parseGameVersion(gameVersion)
  if (parsed === null) return 21
  const [major, minor] = parsed
  if (major >= 26) return 25
  if (major === 1) {
    if (minor >= 20.5) return 21
    if (minor >= 18) return 17
    if (minor >= 17) return 16
    return 8
  }
  return 21
}

/**
 * Parse a game version into a comparable `[major, minor]` pair.
 *
 * Patch releases are folded into the minor as a decimal so "1.20.4" < "1.20.5"
 * and the Java-21 cutoff can be expressed as a single comparison.
 *
 * @returns null when the string does not start with a number.
 */
export function parseGameVersion(gameVersion: string): [number, number] | null {
  const value = gameVersion.trim()
  const match = /^(\d+)(?:\.(\d+))?/.exec(value)
  if (!match) return null
  const major = Number(match[1])
  if (!Number.isFinite(major)) return null
  const minor = match[2] === undefined ? 0 : Number(match[2])
  if (major !== 1) return [major, minor]
  const patch = /^1\.(\d+)\.(\d+)/.exec(value)
  if (!patch) return [major, minor]
  return [major, minor + Number(patch[2]) / 10]
}

/** Human readable game-version span supported by a Java major version. */
export function supportedGameVersions(major: number): string {
  if (major >= 25) return '1.21.9 及更新'
  if (major >= 21) return '1.20.5 – 1.21.8'
  if (major >= 17) return '1.18 – 1.20.4'
  if (major >= 16) return '1.17'
  if (major >= 11) return '1.16.5 部分版本'
  return '1.16.5 及更早'
}
