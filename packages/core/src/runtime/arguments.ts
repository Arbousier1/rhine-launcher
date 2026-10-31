/**
 * Minecraft argument list evaluation.
 *
 * Version jsons carry either the legacy `minecraftArguments` string or the
 * modern `arguments: { game, jvm }` structure, where every entry is a plain
 * string or a ruled object (`{ rules, value | values }`). This module resolves
 * both flavours into a flat list of strings with `${placeholder}` expansion.
 */
import type { RawArgument, RawRule } from '../contracts.ts'
import { isAllowed, type PlatformInfo } from './rules.ts'

/** One entry of an argument group: a literal or a ruled object. */
export type ArgumentEntry = string | RawArgument

/** The shape of `arguments.game` / `arguments.jvm` in a version json. */
export type ArgumentGroups = (string | RawArgument)[][]

/** Placeholder map, e.g. `{ '${auth_player_name}': 'Steve' }`. */
export type ArgumentVariables = Record<string, string>

/** Flatten nested argument groups (Mojang nests one level, Forge sometimes two). */
export function flattenArgumentGroups(groups: ArgumentGroups | undefined): ArgumentEntry[] {
  const out: ArgumentEntry[] = []
  for (const group of groups ?? []) {
    if (Array.isArray(group)) {
      for (const entry of group) if (entry !== null && entry !== undefined) out.push(entry)
    } else if (group !== null && group !== undefined) {
      out.push(group as unknown as ArgumentEntry)
    }
  }
  return out
}

const PLACEHOLDER = /\$\{(.*?)\}/g

/**
 * Replace `${key}` placeholders with their values.
 *
 * Unknown placeholders are kept verbatim, exactly like HMCL's
 * `StringArgument`, so a broken version json is visible instead of silently
 * producing an empty argument.
 */
export function expandVariables(template: string, variables: ArgumentVariables): string {
  return template.replace(PLACEHOLDER, (match, name: string) => {
    // Variables are keyed by the full placeholder ("${auth_player_name}") so the
    // same map can be handed to `Object.entries` consumers; accept the bare
    // name as well to keep ad-hoc call sites working.
    return variables[match] ?? variables[name] ?? match
  })
}

/** Values of a ruled argument, accepting both `value` and `values`. */
export function argumentValues(argument: RawArgument): string[] {
  const raw = (argument as RawArgument & { values?: string | string[] }).value
    ?? (argument as RawArgument & { values?: string | string[] }).values
  if (raw === undefined || raw === null) return []
  return Array.isArray(raw) ? raw.filter((item) => typeof item === 'string') : [raw]
}

/** Expand one entry; returns an empty array when its rules do not match. */
export function resolveArgumentEntry(
  entry: ArgumentEntry,
  variables: ArgumentVariables,
  features: Record<string, boolean>,
  platform: PlatformInfo,
): string[] {
  if (typeof entry === 'string') return [expandVariables(entry, variables)]
  if (!entry || typeof entry !== 'object') return []
  const rules = (entry as RawArgument).rules as RawRule[] | undefined
  if (!isAllowed(rules, platform, features)) return []
  return argumentValues(entry).map((value) => expandVariables(value, variables))
}

/** Resolve a whole argument group list. */
export function evaluateArguments(
  groups: ArgumentGroups | undefined,
  variables: ArgumentVariables,
  features: Record<string, boolean>,
  platform: PlatformInfo,
): string[] {
  const out: string[] = []
  for (const entry of flattenArgumentGroups(groups)) {
    out.push(...resolveArgumentEntry(entry, variables, features, platform))
  }
  return out
}

/**
 * Split a legacy `minecraftArguments` string into tokens.
 *
 * Whitespace separates tokens; double quotes group a value that contains
 * spaces (a few modded manifests rely on this for `-Dpcl.` style values).
 */
export function tokenizeArguments(text: string | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  let current = ''
  let quoted = false
  for (const char of text) {
    if (char === '"') {
      quoted = !quoted
      continue
    }
    if (!quoted && (char === ' ' || char === '\t' || char === '\r' || char === '\n')) {
      if (current) out.push(current)
      current = ''
      continue
    }
    current += char
  }
  if (current) out.push(current)
  return out
}

/** Expand a list of already tokenised arguments. */
export function expandArgumentList(list: string[], variables: ArgumentVariables): string[] {
  return list.filter((item) => typeof item === 'string' && item.length > 0)
    .map((item) => expandVariables(item, variables))
}
