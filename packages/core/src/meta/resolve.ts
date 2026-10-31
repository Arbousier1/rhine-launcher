/**
 * Version-json inheritance resolution.
 *
 * A loader version json typically only contains its own libraries and
 * arguments plus an `inheritsFrom` pointer at the vanilla version. Launching
 * needs the merged view, so this module implements the same merge HMCL's
 * `GameInstanceManifest.merge` performs:
 *
 * - scalar fields (`mainClass`, `assets`, `assetIndex`, `javaVersion`, ...)
 *   come from the child, falling back to the parent;
 * - `libraries` are concatenated child-first and deduplicated by name;
 * - `arguments` are concatenated child-first per bucket;
 * - `inheritsFrom` is cleared on the merged result.
 *
 * Everything here is pure so it can be unit tested without disk or network.
 */
import type { RawArgument, RawVersionJson } from '../contracts.ts'
import { mergeLibraries } from './maven.ts'

/** Values accepted inside an `arguments.game` / `arguments.jvm` bucket. */
type ArgumentEntry = string | RawArgument

/**
 * Normalise an argument bucket into a flat entry list.
 *
 * The shared contract types the bucket as `(string | RawArgument)[][]`, while
 * real version jsons store a flat array. Both spellings are supported so the
 * merge can run on either shape.
 */
export function normalizeArgumentBucket(
  bucket: ArgumentEntry[] | ArgumentEntry[][] | undefined,
): ArgumentEntry[] | undefined {
  if (!bucket) return undefined
  const out: ArgumentEntry[] = []
  for (const entry of bucket) {
    if (Array.isArray(entry)) out.push(...entry)
    else out.push(entry)
  }
  return out
}

/** Concatenate two buckets child-first, dropping empty results. */
function mergeBucket(
  child: ArgumentEntry[] | ArgumentEntry[][] | undefined,
  parent: ArgumentEntry[] | ArgumentEntry[][] | undefined,
): ArgumentEntry[] | undefined {
  const left = normalizeArgumentBucket(child) ?? []
  const right = normalizeArgumentBucket(parent) ?? []
  if (!left.length && !right.length) return undefined
  return [...left, ...right]
}

/** Fields copied from the child when defined, otherwise inherited. */
const SCALAR_FIELDS = [
  'mainClass',
  'assets',
  'assetIndex',
  'javaVersion',
  'logging',
  'downloads',
  'jar',
  'minimumLauncherVersion',
  'type',
  'releaseTime',
  'time',
  'complianceLevel',
] as const

/**
 * Merge two version jsons where `child` inherits from `parent`.
 *
 * The child wins for scalar fields; lists are concatenated with the child first
 * so libraries loaded last (the mod loader) shadow vanilla ones.
 */
export function mergeVersionJson(child: RawVersionJson, parent: RawVersionJson): RawVersionJson {
  const merged: RawVersionJson = { ...parent }
  for (const field of SCALAR_FIELDS) {
    const value = child[field]
    if (value !== undefined && value !== null) {
      ;(merged as Record<string, unknown>)[field] = value
    }
  }
  merged.id = child.id
  // The inherited client jar keeps the base version id even after inheritsFrom
  // is removed. Loader profiles normally have no client jar of their own.
  if (child.jar === undefined && child.downloads?.client === undefined) merged.jar = typeof parent.jar === 'string' ? parent.jar : parent.id
  merged.libraries = mergeLibraries(child.libraries, parent.libraries)
  if (child.arguments || parent.arguments) {
    merged.arguments = {
      game: mergeBucket(child.arguments?.game, parent.arguments?.game),
      jvm: mergeBucket(child.arguments?.jvm, parent.arguments?.jvm),
    } as RawVersionJson['arguments']
  }
  // A legacy string and a modern arguments block are mutually exclusive; the
  // child wins when both are present.
  if (child.minecraftArguments !== undefined) {
    merged.minecraftArguments = child.minecraftArguments
  } else if (parent.minecraftArguments !== undefined) {
    merged.minecraftArguments = parent.minecraftArguments
  }
  delete merged.inheritsFrom
  return merged
}

/**
 * Fold a chain (child first) into a single json.
 *
 * @param chain — version jsons ordered from the most derived to vanilla.
 */
export function resolveChain(chain: RawVersionJson[]): RawVersionJson {
  if (chain.length === 0) throw new Error('版本链为空，无法解析')
  let merged: RawVersionJson = { ...chain[0] }
  for (let index = 1; index < chain.length; index++) {
    merged = mergeVersionJson(merged, chain[index])
  }
  return merged
}

/** Collect the version id of the vanilla root of a chain (child first). */
export function vanillaRootId(chain: RawVersionJson[]): string | undefined {
  if (chain.length === 0) return undefined
  return chain[chain.length - 1].id
}

/** Collect every inherited version id of a chain, most-derived first. */
export function inheritedIds(chain: RawVersionJson[]): string[] {
  return chain.slice(1).map((json) => json.id)
}

/** Library names of a merged json (diagnostics). */
export function libraryNames(json: RawVersionJson): string[] {
  return (json.libraries ?? []).map((library) => library.name)
}

/**
 * Resolve the effective asset index id of a merged json.
 *
 * Older jsons only carry `assets` ("1.7.10"), newer ones carry `assetIndex.id`.
 * The launcher writes `assets/indexes/<id>.json`, so both spellings are mapped.
 */
export function assetIndexId(json: RawVersionJson): string {
  return json.assetIndex?.id ?? json.assets ?? json.id
}

/** The java component/major a version needs, defaulting to Java 8. */
export function requiredJava(json: RawVersionJson): { component?: string; majorVersion: number } {
  const javaVersion = json.javaVersion
  if (javaVersion && typeof javaVersion.majorVersion === 'number') {
    return { component: javaVersion.component, majorVersion: javaVersion.majorVersion }
  }
  return { majorVersion: 8 }
}

/** The jar id a version should load its client jar from (defaults to itself). */
export function clientJarId(json: RawVersionJson): string {
  const jar = json['jar']
  return typeof jar === 'string' && jar ? jar : json.id
}
