/**
 * OptiFine protocol and patcher.
 *
 * OptiFine is not a normal loader profile: its installer jar embeds xdelta
 * patches, the optifine.Patcher entry point and a private launchwrapper build.
 * Installing therefore means:
 *   1. download and validate the installer jar (BMCLAPI's OptiFine archive);
 *   2. extract the embedded launchwrapper-of-<version>.jar into libraries/;
 *   3. run 'java -cp installer.jar optifine.Patcher <base.jar> <installer.jar> <out.jar>';
 *   4. write an inheriting version json with launchwrapper's Launch main class
 *      and the OptiFine tweak class.
 */
import type { RawVersionJson } from '../contracts.ts'
import type { LoaderVersion } from '../types.ts'
import type { LoadedVersionJson } from './types.ts'

/** Main class provided by the embedded launchwrapper. */
export const OPTIFINE_MAIN_CLASS = 'net.minecraft.launchwrapper.Launch'

/** Tweak class provided by the patched output jar. */
export const OPTIFINE_TWEAK_CLASS = 'optifine.OptiFineTweaker'

/** Forge-compatible tweak class (used when OptiFine sits on top of Forge). */
export const OPTIFINE_FORGE_TWEAK_CLASS = 'optifine.OptiFineForgeTweaker'

/** BMCLAPI OptiFine service. */
export const OPTIFINE_API_BASE = 'https://bmclapi2.bangbang93.com'

/** BMCLAPI maven root (stores the actual OptiFine archives). */
export const OPTIFINE_MAVEN_BASE = 'https://bmclapi2.bangbang93.com/maven'

/** One entry of the BMCLAPI OptiFine list. */
export interface OptiFineEntry {
  mcversion?: string
  patch?: string
  type?: string
  filename?: string
  forge?: string
}

/** Normalised OptiFine build. */
export interface OptiFineBuild {
  /** Loader version shown to the user/in the instance config, e.g. HD_U_I5_pre4. */
  loaderVersion: string
  /** Edition prefix, e.g. HD_U or HD_U_I5. */
  type: string
  /** Patch part, e.g. I6 or pre4. */
  patch: string
  filename: string
  preview: boolean
  forge?: string
  notes?: string
}

/** Candidate URLs of the OptiFine build list for one game version. */
export function optifineListUrls(gameVersion: string): string[] {
  return [OPTIFINE_API_BASE + '/optifine/' + encodeURIComponent(gameVersion)]
}

/** Parse BMCLAPI's OptiFine list into normalised builds, newest stable first. */
export function parseOptiFineEntries(payload: unknown, gameVersion: string): OptiFineBuild[] {
  if (!Array.isArray(payload)) return []
  const builds: OptiFineBuild[] = []
  for (const raw of payload as OptiFineEntry[]) {
    const type = typeof raw?.type === 'string' ? raw.type.trim() : ''
    const patch = typeof raw?.patch === 'string' ? raw.patch.trim() : ''
    if (!type || !patch) continue
    const filename = typeof raw.filename === 'string' && raw.filename
      ? raw.filename
      : optifineFilename(type, patch, gameVersion)
    const preview = isPreviewPatch(patch)
    builds.push({
      loaderVersion: type + '_' + patch,
      type,
      patch,
      filename,
      preview,
      forge: typeof raw.forge === 'string' ? raw.forge : undefined,
      notes: filename + (raw.forge ? ' (' + raw.forge + ')' : ''),
    })
  }
  return sortOptiFineBuilds(builds)
}

/** Convert builds into the shared LoaderVersion shape. */
export function optifineVersions(payload: unknown, gameVersion: string): LoaderVersion[] {
  return parseOptiFineEntries(payload, gameVersion).map((build) => ({
    version: build.loaderVersion,
    type: build.preview ? 'snapshot' : 'release',
    gameVersion,
    notes: build.notes,
    stable: !build.preview,
  }))
}

/**
 * Split a loader version into the API's type/patch pair.
 *
 * The user-facing value is '<type>_<patch>'; the last underscore separates the
 * patch because editions themselves contain underscores (HD_U_I5).
 */
export function splitOptiFineVersion(loaderVersion: string): { type: string; patch: string } | undefined {
  const text = (loaderVersion ?? '').trim()
  const index = text.lastIndexOf('_')
  if (index <= 0 || index === text.length - 1) return undefined
  const type = text.slice(0, index)
  const patch = text.slice(index + 1)
  // A patch is 'I5', 'H9', ... or a preview 'pre4'; 'HD_U' alone is not a build.
  if (!/^(?:pre\d+|[A-Z]\d+)$/i.test(patch)) return undefined
  if (!/^(?:HD|OF)_/i.test(type) && !/^HD_/i.test(type)) return undefined
  return { type, patch }
}

/** File name OptiFine uses inside its maven repository. */
export function optifineFilename(type: string, patch: string, gameVersion: string): string {
  const prefix = isPreviewPatch(patch) ? 'preview_' : ''
  return prefix + 'OptiFine_' + gameVersion + '_' + type + '_' + patch + '.jar'
}

/** Candidate installer/download URLs for one build (all HTTPS). */
export function optifineInstallerUrls(
  gameVersion: string,
  loaderVersion: string,
  filename?: string,
): string[] {
  const split = splitOptiFineVersion(loaderVersion)
  if (!split) throw new Error('OptiFine 版本格式不正确：' + loaderVersion)
  const name = filename ?? optifineFilename(split.type, split.patch, gameVersion)
  return [
    OPTIFINE_API_BASE + '/optifine/' + encodeURIComponent(gameVersion)
      + '/' + encodeURIComponent(split.type) + '/' + encodeURIComponent(split.patch),
    OPTIFINE_MAVEN_BASE + '/com/optifine/' + encodeURIComponent(gameVersion) + '/' + encodeURIComponent(name),
  ]
}

/** Installed version id. */
export function optifineVersionId(gameVersion: string, loaderVersion: string): string {
  return gameVersion + '-OptiFine_' + loaderVersion
}

/** Maven-relative path of the patched OptiFine overlay jar. */
export function optifineLibraryPath(gameVersion: string, loaderVersion: string): string {
  const folder = gameVersion + '_' + loaderVersion
  return 'optifine/OptiFine/' + folder + '/OptiFine-' + folder + '.jar'
}

/** Maven-relative path of an extracted launchwrapper build. */
export function launchwrapperLibraryPath(version: string): string {
  return 'optifine/launchwrapper-of/' + version + '/launchwrapper-of-' + version + '.jar'
}

/** Library coordinate name of the patched OptiFine jar. */
export function optifineLibraryName(gameVersion: string, loaderVersion: string): string {
  return 'optifine:OptiFine:' + gameVersion + '_' + loaderVersion
}

/** Library coordinate name of the embedded launchwrapper. */
export function launchwrapperLibraryName(version: string): string {
  return 'optifine:launchwrapper-of:' + version
}

/** Input for {@link buildOptiFineVersionJson}. */
export interface OptiFineVersionInput {
  gameVersion: string
  loaderVersion: string
  optifine: { path: string; sha1?: string; size?: number }
  launchwrapper: { version: string; path: string; sha1?: string; size?: number }
  /** Base version's legacy argument string, appended for pre-1.13 versions. */
  legacyArguments?: string
}

/** Build the inheriting version json that launches OptiFine. */
export function buildOptiFineVersionJson(input: OptiFineVersionInput): RawVersionJson {
  const { gameVersion, loaderVersion } = input
  const json = {
    id: optifineVersionId(gameVersion, loaderVersion),
    inheritsFrom: gameVersion,
    type: 'release',
    mainClass: OPTIFINE_MAIN_CLASS,
    assets: undefined,
    arguments: {
      game: ['--tweakClass', OPTIFINE_TWEAK_CLASS],
      jvm: [],
    },
    libraries: [
      {
        name: optifineLibraryName(gameVersion, loaderVersion),
        downloads: {
          artifact: {
            path: input.optifine.path,
            sha1: input.optifine.sha1,
            size: input.optifine.size,
          },
        },
      },
      {
        name: launchwrapperLibraryName(input.launchwrapper.version),
        downloads: {
          artifact: {
            path: input.launchwrapper.path,
            sha1: input.launchwrapper.sha1,
            size: input.launchwrapper.size,
          },
        },
      },
    ],
  } as unknown as RawVersionJson
  if (input.legacyArguments !== undefined) {
    json.arguments = undefined
    json.minecraftArguments = input.legacyArguments + ' --tweakClass ' + OPTIFINE_TWEAK_CLASS
  }
  return json
}

/** Extract the loader version from an installed OptiFine id. */
export function optifineVersionFromId(id: string): string | undefined {
  if (typeof id !== 'string') return undefined
  const match = /OptiFine[_-](.+)$/i.exec(id)
  return match ? match[1] : undefined
}

/** Classify an installed version json as OptiFine. */
export function classifyOptiFineVersion(json: LoadedVersionJson, id: string): { version?: string } | undefined {
  const names = (json.libraries ?? []).map((library) => library?.name ?? '')
  const libraryHit = names.some((name) => name.startsWith('optifine:OptiFine') || name.startsWith('optifine:launchwrapper'))
  const idHit = typeof id === 'string' && /OptiFine/i.test(id)
  const tweakHit = JSON.stringify(json.arguments ?? '').includes('optifine.OptiFineTweaker')
  if (!libraryHit && !idHit && !tweakHit) return undefined
  const version = optifineVersionFromId(id)
  return version ? { version } : {}
}

/** True when the patch is a preview build (pre4, pre5, ...). */
export function isPreviewPatch(patch: string): boolean {
  return /^pre\d+/i.test((patch ?? '').trim())
}

/** Sort stable builds newest-first, then previews newest-first. */
export function sortOptiFineBuilds(builds: OptiFineBuild[]): OptiFineBuild[] {
  return [...builds].sort((left, right) => {
    if (left.preview !== right.preview) return left.preview ? 1 : -1
    const leftEdition = editionOf(left)
    const rightEdition = editionOf(right)
    if (leftEdition !== rightEdition) return rightEdition - leftEdition
    return previewNumber(right) - previewNumber(left)
  })
}

function editionOf(build: OptiFineBuild): number {
  const match = /(?:^|_)I(\d+)/i.exec(build.type + '_' + build.patch)
  return match ? Number(match[1]) : 0
}

function previewNumber(build: OptiFineBuild): number {
  const match = /^pre(\d+)/i.exec(build.patch)
  return match ? Number(match[1]) : 0
}