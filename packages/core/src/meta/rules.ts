/**
 * Minecraft compatibility-rule evaluation.
 *
 * The semantics follow the official launcher and HMCL's `CompatibilityRule`:
 * evaluation starts at DISALLOW, and every rule whose conditions match the
 * current environment overwrites the running verdict. A version json entry
 * without rules is always allowed.
 *
 * This module is pure: it takes the environment explicitly so the launcher can
 * evaluate rules for a remote machine profile in tests and diagnostics.
 */
import os from 'node:os'
import type { RawRule } from '../contracts.ts'

/** Mojang OS names used inside version json rules. */
export type MinecraftOsName = 'windows' | 'osx' | 'linux'

/** Environment a rule is evaluated against. */
export interface RuleEnvironment {
  os: {
    /** Mojang-style OS name. */
    name: MinecraftOsName
    /** Canonical architecture name (`x64`, `x86`, `arm64`, ...). */
    arch: string
    /** OS version string that `os.version` regexes are matched against. */
    version: string
  }
  /** Feature flags such as `has_custom_resolution`; absent means `undefined`. */
  features: Record<string, boolean | undefined>
}

/** Features that the official launcher may enable for a launch. */
export interface RuleFeatures {
  is_demo_user?: boolean
  has_custom_resolution?: boolean
  has_quick_plays_support?: boolean
  is_quick_play_singleplayer?: boolean
  is_quick_play_multiplayer?: boolean
  is_quick_play_realms?: boolean
  [key: string]: boolean | undefined
}

const OS_ALIASES: Record<string, MinecraftOsName> = {
  windows: 'windows',
  win: 'windows',
  win32: 'windows',
  osx: 'osx',
  macos: 'osx',
  mac: 'osx',
  darwin: 'osx',
  linux: 'linux',
  unix: 'linux',
  freebsd: 'linux',
  sunos: 'linux',
  solaris: 'linux',
}

const ARCH_ALIASES: Record<string, string[]> = {
  x64: ['x64', 'x86_64', 'amd64', 'x86-64'],
  x86: ['x86', 'i386', 'i486', 'i586', 'i686', 'ia32', 'x86-32'],
  arm64: ['arm64', 'aarch64'],
  arm32: ['arm', 'arm32', 'armv7'],
  unknown: ['unknown'],
}

/**
 * Map `process.platform` / `os.arch()` to the launcher's canonical names.
 *
 * Mojang rules use `windows`/`osx`/`linux` and `x86`/`x64`; HMCL additionally
 * accepts combined descriptors such as `win-x86` written by some modpacks.
 */
export function hostOsName(platform: string = process.platform): MinecraftOsName {
  if (platform === 'win32') return 'windows'
  if (platform === 'darwin') return 'osx'
  return 'linux'
}

/** Normalise a Node architecture string (`x64`, `ia32`, `arm64`). */
export function hostArchName(arch: string = process.arch): string {
  switch (arch) {
    case 'x64':
      return 'x64'
    case 'ia32':
      return 'x86'
    case 'arm64':
      return 'arm64'
    case 'arm':
      return 'arm32'
    default:
      return arch || 'unknown'
  }
}

/** All names a rule may use to refer to the given architecture. */
export function archAliases(arch: string): string[] {
  return ARCH_ALIASES[arch] ?? [arch]
}

/** Build the environment descriptor for the machine running the launcher. */
export function currentEnvironment(features: RuleFeatures = {}): RuleEnvironment {
  return {
    os: {
      name: hostOsName(),
      arch: hostArchName(),
      version: os.release(),
    },
    features: { ...features },
  }
}

/** True when a single `os.name` value matches the environment OS. */
function osNameMatches(pattern: string, actual: MinecraftOsName): boolean {
  const key = pattern.trim().toLowerCase()
  const parsed = OS_ALIASES[key]
  if (parsed) return parsed === actual
  // Loose matching mirrors HMCL: "windows 11", "linux-gnu" etc. still match.
  if (key.includes('win')) return actual === 'windows'
  if (key.includes('mac') || key.includes('darwin') || key.includes('osx')) return actual === 'osx'
  if (key.includes('linux') || key.includes('unix') || key.includes('solaris') || key.includes('sunos')) {
    return actual === 'linux'
  }
  return false
}

/** True when a rule `os.arch` regex matches one of the architecture aliases. */
function archMatches(pattern: string, arch: string): boolean {
  const aliases = archAliases(arch)
  let regex: RegExp
  try {
    regex = new RegExp(`^(?:${pattern})$`, 'i')
  } catch {
    return aliases.some((alias) => alias.toLowerCase() === pattern.toLowerCase())
  }
  return aliases.some((alias) => regex.test(alias))
}

/** Full-match a rule regex against a value; invalid regexes fall back to equality. */
function regexMatches(pattern: string, value: string): boolean {
  try {
    return new RegExp(`^(?:${pattern})$`).test(value)
  } catch {
    return pattern === value
  }
}

/**
 * Parse a combined descriptor such as `win-x86` or `osx-arm64`.
 *
 * Some modpacks (and old Forge jsons) put the architecture inside `os.name`.
 *
 * @returns the split halves, or `undefined` when the value is a plain OS name.
 */
export function splitOsDescriptor(value: string): { name: MinecraftOsName; arch: string } | undefined {
  const dash = value.indexOf('-')
  if (dash <= 0) return undefined
  const osPart = OS_ALIASES[value.slice(0, dash).toLowerCase()]
  const archPart = value.slice(dash + 1).toLowerCase()
  const arch = Object.entries(ARCH_ALIASES).find(([, aliases]) => aliases.includes(archPart))?.[0]
  if (!osPart || !arch) return undefined
  return { name: osPart, arch }
}

/** True when a rule's conditions match the environment, ignoring its action. */
export function ruleApplies(rule: RawRule, env: RuleEnvironment): boolean {
  const ruleOs = rule.os
  if (ruleOs) {
    if (ruleOs.name) {
      const combined = splitOsDescriptor(ruleOs.name)
      if (combined) {
        if (combined.name !== env.os.name) return false
        if (!archMatches(combined.arch, env.os.arch)) return false
      } else if (!osNameMatches(ruleOs.name, env.os.name)) {
        return false
      }
    }
    if (ruleOs.arch && !archMatches(ruleOs.arch, env.os.arch)) return false
    if (ruleOs.version && !regexMatches(ruleOs.version, env.os.version)) return false
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      // A missing feature is `undefined` and never equals an explicit boolean.
      if (env.features[key] !== expected) return false
    }
  }
  return true
}

/**
 * Evaluate a rule list against an environment.
 *
 * Starts from DISALLOW (matching the official launcher), then lets every
 * matching rule overwrite the verdict. An empty or missing rule list allows
 * the entry.
 */
export function evaluateRules(rules: RawRule[] | undefined, env: RuleEnvironment): boolean {
  if (!rules || rules.length === 0) return true
  let allowed = false
  for (const rule of rules) {
    if (ruleApplies(rule, env)) allowed = rule.action === 'allow'
  }
  return allowed
}

/** Keep the entries whose rules allow the current environment. */
export function filterByRules<T extends { rules?: RawRule[] }>(
  entries: T[] | undefined,
  env: RuleEnvironment,
): T[] {
  if (!entries) return []
  return entries.filter((entry) => evaluateRules(entry.rules, env))
}
