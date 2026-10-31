/**
 * Mod descriptor extraction.
 *
 * Supports the four descriptor formats HMCL understands: Fabric, Quilt, Forge
 * (`mods.toml`), NeoForge (`neoforge.mods.toml`) and the legacy `mcmod.info`.
 * The first descriptor found wins; a jar without any descriptor is still a
 * valid (if unusual) file and is reported with just its file name.
 */
import { readFile, stat } from 'node:fs/promises'
import { basename, extname } from 'node:path'
import type { LoaderKind, ModMeta } from '../types.ts'
import { parseToml, tomlGet, tomlString, type TomlTable, type TomlValue } from './toml.ts'
import { ZipArchive, ZipError } from './zip.ts'

/** Descriptor files probed inside a jar, in priority order. */
export const DESCRIPTOR_FILES: { file: string; loader: LoaderKind }[] = [
  { file: 'fabric.mod.json', loader: 'fabric' },
  { file: 'quilt.mod.json', loader: 'quilt' },
  { file: 'META-INF/neoforge.mods.toml', loader: 'neoforge' },
  { file: 'META-INF/mods.toml', loader: 'forge' },
  { file: 'mcmod.info', loader: 'forge' },
  { file: 'META-INF/MANIFEST.MF', loader: 'vanilla' },
]

/** Platform-level dependencies that are not real mods. */
const SKIPPED_DEPENDENCIES = new Set(['minecraft', 'java', 'fabricloader', 'quilt_loader', 'forge', 'neoforge'])

/** Largest icon we are willing to inline as a data URL. */
export const MAX_ICON_BYTES = 256 * 1024

/** Text file extensions that cannot be a mod jar. */
const TEXT_EXTENSIONS = new Set(['.txt', '.json', '.toml', '.disabled', '.log', '.cfg', '.yml', '.yaml'])

/** Extension of a jar file, tolerating the `.jar.disabled` suffix. */
export function jarExtension(file: string): string {
  const name = file.toLowerCase().replace(/\.disabled$/, '')
  return extname(name)
}

/** Is this a candidate mod archive? */
export function looksLikeJar(file: string): boolean {
  const extension = jarExtension(file)
  if (extension === '.jar' || extension === '.zip' || extension === '.litemod') return true
  return extension === '' && !TEXT_EXTENSIONS.has(extname(file.toLowerCase()))
}

/**
 * Read a mod descriptor from a jar on disk.
 *
 * Returns `undefined` when the file is not a readable archive; descriptor
 * problems (bad JSON, missing fields) only blank the affected fields.
 */
export async function readModDescriptor(file: string): Promise<ModMeta | undefined> {
  const info = await stat(file).catch(() => undefined)
  if (!info?.isFile()) return undefined
  if (!looksLikeJar(file)) return undefined

  let archive: ZipArchive
  try {
    archive = await ZipArchive.open(file)
  } catch (error) {
    if (error instanceof ZipError) return fallbackMeta(file)
    throw error
  }

  try {
    for (const candidate of DESCRIPTOR_FILES) {
      const entry = archive.entry(candidate.file)
      if (!entry) continue
      const text = await archive.readText(candidate.file)
      if (!text) continue
      const meta = candidate.file.endsWith('.toml')
        ? parseForgeToml(text, candidate.loader)
        : candidate.file.endsWith('.json')
          ? parseJsonDescriptor(text, candidate.file, candidate.loader)
          : candidate.file.endsWith('.MF')
            ? parseManifest(text)
            : undefined
      if (!meta) continue
      meta.loader ??= candidate.loader
      const iconFile = meta.icon
      if (iconFile) {
        const icon = await readIcon(archive, iconFile)
        if (icon) meta.icon = icon
        else delete meta.icon
      } else {
        delete meta.icon
      }
      return meta
    }
  } catch {
    return fallbackMeta(file)
  } finally {
    await archive.close().catch(() => {})
  }
  return fallbackMeta(file)
}

/** Metadata derived purely from the file name. */
export function fallbackMeta(file: string): ModMeta {
  const name = basename(file).replace(/\.disabled$/i, '').replace(/\.jar$/i, '')
  return { name }
}

/** Read an icon entry and convert it to a data URL. */
async function readIcon(archive: ZipArchive, iconPath: string): Promise<string | undefined> {
  const entry = archive.entry(iconPath.replace(/^\//, ''))
  if (!entry) return undefined
  if (entry.uncompressedSize > MAX_ICON_BYTES) return undefined
  const data = await archive.read(entry.name)
  if (!data) return undefined
  const mime = mimeOf(entry.name)
  if (!mime) return undefined
  return `data:${mime};base64,${Buffer.from(data).toString('base64')}`
}

/** Guess an image MIME type from the extension. */
export function mimeOf(file: string): string | undefined {
  const extension = extname(file.toLowerCase())
  if (extension === '.png') return 'image/png'
  if (extension === '.jpg' || extension === '.jpeg') return 'image/jpeg'
  if (extension === '.webp') return 'image/webp'
  if (extension === '.gif') return 'image/gif'
  if (extension === '.svg') return 'image/svg+xml'
  return undefined
}

/** Parse `fabric.mod.json` or `quilt.mod.json`. */
export function parseJsonDescriptor(text: string, file: string, loader: LoaderKind): ModMeta | undefined {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    return undefined
  }
  if (!json || typeof json !== 'object') return undefined

  // Quilt wraps the fabric-shaped payload inside `quilt_loader`.
  const quilt = file.endsWith('quilt.mod.json') ? json.quilt_loader : undefined
  const metadata = quilt?.metadata ?? json
  const id = quilt ? quilt.id : json.id
  const version = (quilt ? quilt.version ?? json.version : json.version) ?? metadata?.version

  const meta: ModMeta = {
    id: typeof id === 'string' ? id : undefined,
    name: pickString(metadata?.name) ?? (typeof id === 'string' ? id : undefined),
    version: typeof version === 'string' ? version : undefined,
    description: pickString(metadata?.description),
    authors: pickAuthors(metadata?.authors ?? json.authors),
    icon: pickIcon(json.icon ?? metadata?.icon),
    dependencies: pickDependencies(json.depends ?? quilt?.depends),
    gameVersions: undefined,
    loader,
  }
  if (!meta.name && !meta.id) return undefined
  return meta
}

function pickString(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  return undefined
}

function pickAuthors(value: unknown): string[] | undefined {
  if (!value) return undefined
  const list: string[] = []
  if (Array.isArray(value)) {
    for (const item of value) {
      if (typeof item === 'string') list.push(item)
      else if (item && typeof item === 'object' && typeof (item as any).name === 'string') list.push((item as any).name)
    }
  } else if (typeof value === 'object') {
    const name = (value as any).name
    if (typeof name === 'string') list.push(name)
  } else if (typeof value === 'string') {
    list.push(value)
  }
  return list.length ? list : undefined
}

/** Fabric icons may be a plain path or a map of size → path. */
function pickIcon(value: unknown): string | undefined {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, path]) => typeof path === 'string') as [string, string][]
    if (!entries.length) return undefined
    entries.sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10))
    return entries[0][1]
  }
  return undefined
}

function pickDependencies(value: unknown): ModMeta['dependencies'] {
  if (!value) return undefined
  const out: ModMeta['dependencies'] = []
  // Quilt lists dependencies as an array of { id, versions }.
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (!entry || typeof entry !== 'object') continue
      const spec = entry as Record<string, any>
      const id = spec.id ?? spec.mod_id
      if (typeof id !== 'string') continue
      if (SKIPPED_DEPENDENCIES.has(id)) continue
      const versions = spec.versions ?? spec.version
      out.push({
        id,
        versionRange: typeof versions === 'string' ? versions : undefined,
        optional: spec.optional === true,
      })
    }
    return out.length ? out : undefined
  }
  if (typeof value !== 'object') return undefined
  for (const [id, raw] of Object.entries(value as Record<string, unknown>)) {
    if (SKIPPED_DEPENDENCIES.has(id)) continue
    if (typeof raw === 'string') {
      out.push({ id, versionRange: raw })
    } else if (Array.isArray(raw)) {
      out.push({ id, versionRange: raw.filter((item) => typeof item === 'string').join(' || ') || undefined })
    } else if (raw && typeof raw === 'object') {
      const spec = raw as Record<string, any>
      out.push({ id, versionRange: spec.version ?? spec.versions, optional: spec.optional === true })
    }
  }
  return out.length ? out : undefined
}

/** Parse a Forge / NeoForge `mods.toml`. */
export function parseForgeToml(text: string, loader: LoaderKind): ModMeta | undefined {
  const table = parseToml(text)
  const mods = table.mods
  const first = Array.isArray(mods) ? (mods[0] as TomlTable | undefined) : undefined
  const modId = tomlString(first?.modId) ?? tomlString(tomlGet(table, 'mods.modId'))
  if (!first && !modId) return undefined

  const meta: ModMeta = {
    id: modId,
    name: tomlString(first?.displayName) ?? modId,
    version: tomlString(first?.version) ?? tomlString(tomlGet(table, 'version')),
    description: tomlString(first?.description) ?? tomlString(tomlGet(table, 'mods.description')),
    authors: splitAuthors(tomlString(first?.authors) ?? tomlString(tomlGet(table, 'mods.authors'))),
    icon: normalizeLogo(tomlString(first?.logoFile) ?? tomlString(tomlGet(table, 'mods.logoFile'))),
    loader,
  }

  const dependencies = collectForgeDependencies(table)
  if (dependencies.length) meta.dependencies = dependencies
  return meta
}

function normalizeLogo(value: string | undefined): string | undefined {
  if (!value) return undefined
  const trimmed = value.trim().replace(/^\//, '')
  return trimmed || undefined
}

function splitAuthors(value: string | undefined): string[] | undefined {
  if (!value) return undefined
  const list = value.split(',').map((item) => item.trim()).filter(Boolean)
  return list.length ? list : undefined
}

/**
 * Gather dependency tables.
 *
 * Forge writes them as `[[dependencies.<modid>]]`, which TOML parses into a
 * table of arrays; a few third-party manifests use a flat `[[dependencies]]`
 * array instead, so both shapes are accepted.
 */
function collectForgeDependencies(table: TomlTable): NonNullable<ModMeta['dependencies']> {
  const raw = table.dependencies
  const out: NonNullable<ModMeta['dependencies']> = []
  if (Array.isArray(raw)) {
    for (const entry of raw) out.push(...parseForgeDependency(entry as TomlTable))
    return out
  }
  if (raw && typeof raw === 'object') {
    for (const value of Object.values(raw as TomlTable)) {
      if (Array.isArray(value)) {
        for (const entry of value) out.push(...parseForgeDependency(entry as TomlTable))
      } else if (value && typeof value === 'object') {
        out.push(...parseForgeDependency(value as TomlTable))
      }
    }
  }
  return out
}

function parseForgeDependency(table: TomlTable): NonNullable<ModMeta['dependencies']> {
  const modId = tomlString(table.modId)
  if (!modId || modId === 'minecraft' || modId === 'neoforge' || modId === 'forge') return []
  return [{
    id: modId,
    versionRange: tomlString(table.versionRange),
    optional: tomlString(table.mandatory) === 'false' || table.mandatory === false,
  }]
}

/** Legacy `mcmod.info` descriptor (array or `{ modList: [] }`). */
export function parseMcmodInfo(text: string): ModMeta | undefined {
  let json: any
  try {
    json = JSON.parse(text)
  } catch {
    return undefined
  }
  const list = Array.isArray(json) ? json : Array.isArray(json?.modList) ? json.modList : []
  const first = list[0]
  if (!first || typeof first !== 'object') return undefined
  const meta: ModMeta = {
    id: pickString(first.modid) ?? pickString(first.modId),
    name: pickString(first.name) ?? pickString(first.modid),
    version: pickString(first.version),
    description: pickString(first.description),
    authors: pickAuthors(first.authorList ?? first.authors),
    icon: normalizeLogo(pickString(first.logoFile)),
    loader: 'forge',
  }
  if (!meta.name && !meta.id) return undefined
  return meta
}

/** Parse `META-INF/MANIFEST.MF` (last resort for plain jars). */
export function parseManifest(text: string): ModMeta | undefined {
  const fields = new Map<string, string>()
  for (const line of text.split(/\r?\n/)) {
    const match = /^([A-Za-z0-9-]+):\s*(.*)$/.exec(line.trim())
    if (match) fields.set(match[1].toLowerCase(), match[2].trim())
  }
  const name = fields.get('implementation-title') ?? fields.get('specification-title')
  const version = fields.get('implementation-version') ?? fields.get('specification-version')
  if (!name && !version) return undefined
  return { name: name ?? undefined, version: version ?? undefined }
}

/** Read and JSON-parse a text file, returning undefined on any error. */
export async function readJsonFile<T>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, 'utf8')) as T
  } catch {
    return undefined
  }
}

/** Describe a parsed descriptor for logging. */
export function describeMod(meta: ModMeta | undefined, file: string): string {
  if (!meta) return file
  return `${meta.name ?? meta.id ?? file}${meta.version ? ' ' + meta.version : ''}`
}
