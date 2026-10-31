/**
 * Mojang Java runtime catalog parsing.
 *
 * Mojang publishes a per-platform catalog (all.json) that points at a manifest
 * describing every file of a JRE. Both documents are machine generated JSON, so
 * the parsing rules here are pure and unit tested against recorded payloads.
 *
 * Live shape (checked against the official endpoint):
 *   all.json    -> { 'windows-x64': { 'java-runtime-gamma': [ { manifest, version } ] } }
 *   manifest    -> { files: { 'bin/java.exe': { type: 'file', downloads: { raw } } } }
 */
import { join } from 'node:path'
import type { DownloadItem } from '../contracts.ts'

/** Official catalog of the Mojang-provided JRE builds. */
export const MOJANG_JAVA_CATALOG_URL =
  'https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json'

/** One downloadable artefact (raw file or the manifest itself). */
export interface MojangJavaDownload {
  url: string
  sha1?: string
  size?: number
}

/** One selectable build of a runtime component for a platform. */
export interface MojangJavaEntry {
  availability?: { group?: number; progress?: number }
  manifest: MojangJavaDownload
  version: { name: string; released?: string }
}

/** The all.json document: platform -> component -> builds. */
export type MojangJavaCatalog = Record<string, Record<string, MojangJavaEntry[]>>

/** One entry of a runtime manifest. */
export interface MojangJavaFile {
  type?: 'file' | 'directory' | 'link'
  executable?: boolean
  /** Relative target of a link entry. */
  target?: string
  downloads?: { raw?: MojangJavaDownload; lzma?: MojangJavaDownload }
}

/** The per-component manifest referenced by {@link MojangJavaEntry}. */
export interface MojangJavaManifest {
  files?: Record<string, MojangJavaFile>
}

/** A link the installer should create inside the runtime directory. */
export interface MojangJavaLink {
  /** Absolute path of the link. */
  path: string
  /** Normalised relative target. */
  target: string
}

/** Everything needed to materialise a JRE without touching the network. */
export interface MojangJavaPlan {
  /** Files to download, with SHA1 verification. */
  files: DownloadItem[]
  /** Directories to create up front. */
  directories: string[]
  /** Symbolic links (skipped on platforms that refuse them). */
  links: MojangJavaLink[]
  /** Files the JVM must be allowed to execute. */
  executables: string[]
}

/**
 * Catalog platform key for the host machine.
 *
 * Minecraft only ships Java for a few combinations; Windows x64 is the default
 * because that is the platform this launcher targets.
 */
export function mojangPlatformKey(platform: NodeJS.Platform = process.platform, arch: string = process.arch): string {
  if (platform === 'win32') {
    if (arch === 'arm64') return 'windows-arm64'
    if (arch === 'ia32') return 'windows-x86'
    return 'windows-x64'
  }
  if (platform === 'darwin') return arch === 'arm64' ? 'mac-os-arm64' : 'mac-os'
  if (arch === 'ia32') return 'linux-i386'
  return 'linux'
}

/** Runtime directory name inside the launcher data root for a component. */
export function javaComponentDirectory(javaRoot: string, component: string): string {
  return join(javaRoot, component)
}

/**
 * Select the runtime build for one component and platform.
 *
 * @param catalog — parsed all.json.
 * @param component — Mojang component id, e.g. 'java-runtime-gamma'.
 * @param platformKey — key from {@link mojangPlatformKey}.
 * @returns the newest usable entry, or undefined when the component is absent.
 */
export function selectJavaRuntimeEntry(
  catalog: MojangJavaCatalog | undefined,
  component: string,
  platformKey = mojangPlatformKey(),
): MojangJavaEntry | undefined {
  const byComponent = catalog?.[platformKey]?.[component]
  if (!Array.isArray(byComponent)) return undefined
  const usable = byComponent.filter((entry) => !!entry?.manifest?.url)
  return usable[0] ?? undefined
}

/**
 * Normalise a path taken from a runtime manifest.
 *
 * Guards against archive traversal: absolute paths, drive letters and '..'
 * segments are rejected ('./' prefixes are normalised away) so a hostile
 * manifest cannot escape the component directory.
 *
 * @returns the POSIX relative path, or undefined when it is unsafe/empty.
 */
export function safeJavaRelativePath(raw: string): string | undefined {
  const posix = (raw ?? '').replace(/\\/g, '/').replace(/^\/+/, '')
  if (!posix) return undefined
  if (/^[A-Za-z]:/.test(posix)) return undefined
  const segments = posix.split('/').filter((segment) => segment.length > 0 && segment !== '.')
  if (!segments.length) return undefined
  if (segments.some((segment) => segment === '..')) return undefined
  return segments.join('/')
}

/**
 * Turn a runtime manifest into a concrete download plan.
 *
 * Mojang ships the JRE file by file (no archive), so each 'file' entry becomes
 * one verified download; links are materialised separately and directories are
 * created before the downloads start.
 *
 * @param manifest — parsed manifest document.
 * @param targetDir — absolute component directory.
 */
export function buildJavaFilePlan(manifest: MojangJavaManifest | undefined, targetDir: string): MojangJavaPlan {
  const plan: MojangJavaPlan = { files: [], directories: [], links: [], executables: [] }
  for (const [rawPath, entry] of Object.entries(manifest?.files ?? {})) {
    const relative = safeJavaRelativePath(rawPath)
    if (!relative) continue
    const destination = join(targetDir, ...relative.split('/'))
    if (entry?.type === 'directory') {
      plan.directories.push(destination)
      continue
    }
    if (entry?.type === 'link') {
      const target = safeJavaRelativePath(entry.target ?? '')
      if (target) plan.links.push({ path: destination, target })
      continue
    }
    const raw = entry?.downloads?.raw
    if (!raw?.url) continue
    plan.files.push({
      url: raw.url,
      destination,
      sha1: raw.sha1,
      size: raw.size,
      skipIfExists: true,
    })
    if (entry?.executable) plan.executables.push(destination)
  }
  return plan
}

/** Absolute path of the java launcher inside an extracted runtime. */
export function runtimeExecutablePath(targetDir: string, platform: NodeJS.Platform = process.platform): string {
  return join(targetDir, 'bin', platform === 'win32' ? 'java.exe' : 'java')
}
