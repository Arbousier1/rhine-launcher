/**
 * Compatibility rule evaluation.
 *
 * Implements the same semantics as the Mojang launcher (and HMCL's
 * `CompatibilityRule`): a rule list defaults to *disallow*, every matching rule
 * overwrites the current action, and the final answer decides whether a
 * library or a command line argument applies to the current environment.
 *
 * Kept free of IO so it can be unit tested on any platform.
 */
import { release as osRelease } from 'node:os'
import type { RawRule } from '../contracts.ts'

/** Operating system names used by the version json `os.name` field. */
export type TargetOs = 'windows' | 'osx' | 'linux'

/** Normalised CPU architecture understood by `os.arch` rules. */
export type TargetArch = 'x64' | 'arm64' | 'x86' | 'arm32' | 'unknown'

/** Description of the machine a command line is built for. */
export interface PlatformInfo {
  /** Mojang name of the operating system. */
  os: TargetOs
  /** Normalised CPU architecture. */
  arch: TargetArch
  /** OS version string matched by `os.version` regular expressions. */
  version: string
  /** Human readable label used in diagnostics, e.g. `windows-x64`. */
  label?: string
}

/** Architecture strings accepted for one normalised architecture. */
const ARCH_ALIASES: Record<TargetArch, string[]> = {
  x64: ['x64', 'x86_64', 'amd64', 'x86-64'],
  x86: ['x86', 'i386', 'i486', 'i586', 'i686', 'ia32', 'x86_32'],
  arm64: ['arm64', 'aarch64', 'armv8'],
  arm32: ['arm', 'arm32', 'armv7'],
  unknown: [],
}

/** All aliases of a normalised architecture, including its own name. */
export function archAliases(arch: TargetArch): string[] {
  return [arch, ...(ARCH_ALIASES[arch] ?? [])]
}

/** Normalise an architecture string coming from a version json or the OS. */
export function normalizeArch(value: string | undefined): TargetArch {
  const text = (value ?? '').toLowerCase()
  for (const arch of Object.keys(ARCH_ALIASES) as TargetArch[]) {
    if (ARCH_ALIASES[arch].includes(text)) return arch
  }
  return 'unknown'
}

/** Map `process.platform` to Mojang's operating system name. */
export function osFromPlatform(platform: NodeJS.Platform = process.platform): TargetOs {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'osx'
  return 'linux'
}

/** Detect the platform the launcher itself is running on. */
export function currentPlatform(): PlatformInfo {
  const os = osFromPlatform()
  const arch = normalizeArch(process.arch)
  return { os, arch, version: osRelease(), label: `${os}-${arch}` }
}

/** OS aliases accepted in `os.name` (including HMCL's `win` spelling). */
const OS_ALIASES: Record<string, TargetOs[]> = {
  windows: ['windows'],
  win: ['windows'],
  win32: ['windows'],
  osx: ['osx'],
  macos: ['osx'],
  mac: ['osx'],
  darwin: ['osx'],
  linux: ['linux'],
  freebsd: ['linux'],
  openbsd: ['linux'],
  unix: ['linux'],
}

/**
 * Check one `os` restriction.
 *
 * Unknown names never restrict, mirroring HMCL which maps them to
 * `OperatingSystem.UNKNOWN` and skips the comparison.
 */
export function osRestrictionMatches(
  restriction: NonNullable<RawRule['os']>,
  platform: PlatformInfo,
): boolean {
  if (restriction.name) {
    const parts = restriction.name.toLowerCase().split('-')
    const targets = OS_ALIASES[parts[0]]
    if (targets && !targets.includes(platform.os)) return false
    // HMCL also accepts combined values such as `win-x86`.
    if (targets && parts.length > 1) {
      const arch = normalizeArch(parts[1])
      if (arch !== 'unknown' && arch !== platform.arch) return false
    }
  }
  if (restriction.arch) {
    const wanted = normalizeArch(restriction.arch)
    // An unrecognised value must not silently disable every library.
    if (wanted !== 'unknown' && wanted !== platform.arch) return false
  }
  if (restriction.version) {
    try {
      if (!new RegExp(restriction.version).test(platform.version)) return false
    } catch {
      // HMCL swallows an invalid pattern and treats the rule as not matching.
      return false
    }
  }
  return true
}

/** Does a single rule match the current environment and feature set? */
export function ruleMatches(
  rule: RawRule,
  platform: PlatformInfo,
  features: Record<string, boolean> = {},
): boolean {
  if (rule.os && !osRestrictionMatches(rule.os, platform)) return false
  if (rule.features) {
    for (const [name, expected] of Object.entries(rule.features)) {
      if ((features[name] ?? false) !== expected) return false
    }
  }
  return true
}

/** The action a rule list resolves to, or `undefined` when no rule matched. */
export function resolveRuleAction(
  rules: RawRule[] | undefined | null,
  platform: PlatformInfo,
  features: Record<string, boolean> = {},
): RawRule['action'] | undefined {
  let action: RawRule['action'] | undefined
  for (const rule of rules ?? []) {
    if (ruleMatches(rule, platform, features)) action = rule.action
  }
  return action
}

/**
 * Whether a ruled entry applies to the current environment.
 *
 * An empty or missing rule list always applies; otherwise the last matching
 * rule wins and no match means "not allowed".
 */
export function isAllowed(
  rules: RawRule[] | undefined | null,
  platform: PlatformInfo,
  features: Record<string, boolean> = {},
): boolean {
  if (!rules || rules.length === 0) return true
  return resolveRuleAction(rules, platform, features) === 'allow'
}
