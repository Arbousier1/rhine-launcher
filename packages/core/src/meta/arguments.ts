/**
 * Version-json argument evaluation.
 *
 * Two formats are supported, exactly like the official launcher and HMCL:
 * - `minecraftArguments` (single whitespace separated string, pre-1.13)
 * - `arguments.game` / `arguments.jvm` (arrays of strings or rule objects)
 *
 * Placeholders written as `${name}` are substituted from a key map; unknown
 * placeholders are left untouched (HMCL behaviour) so downstream code can spot
 * them instead of silently launching with empty values.
 */
import type { RawArgument, RawRule } from '../contracts.ts'
import { evaluateRules, type RuleEnvironment } from './rules.ts'

/** Argument value object as it appears in modern version jsons. */
export interface JsonRuledArgument {
  rules?: RawRule[]
  value?: string | string[]
  /** Legacy spelling used by a few modded jsons (HMCL accepts both). */
  values?: string | string[]
}

/** One element of an `arguments.game` / `arguments.jvm` array. */
export type JsonArgument = string | JsonRuledArgument

/**
 * Shape stored in {@link RawVersionJson.arguments} buckets.
 *
 * The shared contract declares the buckets as `(string | RawArgument)[][]`,
 * while real version jsons store a flat array. Both spellings are accepted here
 * and normalised with {@link normalizeArgumentList}.
 */
export type ArgumentBucket = JsonArgument | JsonArgument[]

/** Key map used for `${...}` substitution. */
export type ArgumentKeys = Record<string, string | string[] | undefined>

const PLACEHOLDER = /\$\{([^}]*)\}/g

/**
 * Substitute `$\{key\}` placeholders in a single argument.
 *
 * @param value — raw argument text.
 * @param keys — substitution table; missing keys keep the placeholder.
 */
export function substituteKeys(value: string, keys: ArgumentKeys): string {
  return value.replace(PLACEHOLDER, (match, name: string) => {
    const replacement = keys[name.trim()]
    if (replacement === undefined) return match
    return Array.isArray(replacement) ? replacement.join(' ') : replacement
  })
}

/** True when the argument object has a usable value list. */
function valuesOf(argument: JsonRuledArgument): string[] {
  const raw = argument.value ?? argument.values
  if (raw === undefined || raw === null) return []
  return Array.isArray(raw) ? raw.filter((entry) => typeof entry === 'string') : [raw]
}

/**
 * Expand one argument entry.
 *
 * Strings always apply; objects apply only when their rules match, matching the
 * official "last matching rule wins" semantics.
 */
export function expandArgument(
  argument: JsonArgument,
  env: RuleEnvironment,
  keys: ArgumentKeys,
): string[] {
  if (typeof argument === 'string') return [substituteKeys(argument, keys)]
  if (!evaluateRules(argument.rules, env)) return []
  return valuesOf(argument)
}

/** Expand a whole argument array. */
export function expandArguments(
  arguments_: JsonArgument[] | undefined,
  env: RuleEnvironment,
  keys: ArgumentKeys,
): string[] {
  if (!arguments_) return []
  const out: string[] = []
  for (const argument of arguments_) {
    out.push(...expandArgument(argument, env, keys))
  }
  return out
}

/**
 * Split a legacy `minecraftArguments` string.
 *
 * Vanilla simply splits on spaces, but modded jsons occasionally quote values
 * containing spaces, so quotes are honoured here.
 */
export function splitLegacyArguments(text: string | undefined): string[] {
  if (!text) return []
  const out: string[] = []
  let current = ''
  let quote: '"' | "'" | undefined
  let started = false
  for (const char of text) {
    if (quote) {
      if (char === quote) {
        quote = undefined
      } else {
        current += char
      }
      continue
    }
    if (char === '"' || char === "'") {
      quote = char
      started = true
      continue
    }
    if (char === ' ' || char === '\t' || char === '\n' || char === '\r') {
      if (started || current) {
        out.push(current)
        current = ''
        started = false
      }
      continue
    }
    current += char
  }
  if (started || current) out.push(current)
  return out
}

/** Arguments parsed out of one version json (before inheritance merging). */
export interface ParsedArguments {
  game: string[]
  jvm: string[]
}

/**
 * Evaluate both argument buckets of a single version json.
 *
 * Falls back to `minecraftArguments` for legacy versions. `DEFAULT_JVM_ARGUMENTS`
 * are added by the launch layer, not here, because they depend on absolute
 * paths the metadata layer does not know.
 */
export function resolveArguments(
  json: { arguments?: { game?: JsonArgument[]; jvm?: JsonArgument[] }; minecraftArguments?: string },
  env: RuleEnvironment,
  keys: ArgumentKeys = {},
): ParsedArguments {
  const modern = json.arguments
  if (modern && (modern.game || modern.jvm)) {
    return {
      game: expandArguments(modern.game, env, keys),
      jvm: expandArguments(modern.jvm, env, keys),
    }
  }
  return {
    game: splitLegacyArguments(json.minecraftArguments).map((entry) => substituteKeys(entry, keys)),
    jvm: [],
  }
}

/**
 * Default JVM arguments used by versions without an `arguments.jvm` block.
 *
 * Mirrors HMCL's `Arguments.DEFAULT_JVM_ARGUMENTS` so pre-1.13 versions still
 * receive the classpath and native path.
 */
export function defaultJvmArguments(): JsonArgument[] {
  return [
    {
      rules: [{ action: 'allow', os: { name: 'windows' } }],
      value: [
        '-XX:HeapDumpPath=MojangTricksIntelDriversForPerformance_javaw.exe_minecraft.exe.heapdump',
      ],
    },
    {
      rules: [{ action: 'allow', os: { name: 'windows', version: '^10\\.' } }],
      value: ['-Dos.name=Windows 10', '-Dos.version=10.0'],
    },
    '-Djava.library.path=${natives_directory}',
    '-Dminecraft.launcher.brand=${launcher_name}',
    '-Dminecraft.launcher.version=${launcher_version}',
    '-cp',
    '${classpath}',
  ]
}

/** Default game arguments used by versions without an `arguments.game` block. */
export function defaultGameArguments(): JsonArgument[] {
  return [
    {
      rules: [{ action: 'allow', features: { has_custom_resolution: true } }],
      value: ['--width', '${resolution_width}', '--height', '${resolution_height}'],
    },
  ]
}

/** Re-export for callers that only need the rule evaluation helper. */
export { evaluateRules }
export type { RawArgument, RawRule, RuleEnvironment }
