/**
 * Request payload → domain type coercion.
 *
 * Hono ships validators for Zod/Valibot/TypeBox, but the launcher intentionally
 * avoids adding a dependency, so these hand written parsers are the single
 * place where untrusted JSON becomes a `@rhine/core` type. Every rejection
 * throws {@link ApiError} with a Chinese, user facing message.
 */
import type {
  InstanceConfig, LaunchRequest, LoaderKind, LoaderSpec, MarketSearchInput, MarketVersion,
  ProjectType, Settings,
} from '@rhine/core'
import {
  ApiError, enumValue, optionalBoolean, optionalInteger, optionalString, optionalStringArray,
  queryInteger, requiredString, type JsonObject,
} from './http.ts'

/** Loader kinds understood by `ctx.loader`. */
export const LOADER_KINDS = [
  'vanilla', 'fabric', 'quilt', 'forge', 'neoforge', 'optifine', 'liteloader',
] as const satisfies readonly LoaderKind[]

/** Marketplace project types. */
export const PROJECT_TYPES = [
  'mod', 'resourcepack', 'shader', 'modpack', 'datapack', 'plugin',
] as const satisfies readonly ProjectType[]

/** Marketplace sources. */
export const MARKET_SOURCES = ['modrinth', 'curseforge'] as const

/** Marketplace search orders. */
export const MARKET_SORTS = ['relevance', 'downloads', 'follows', 'updated', 'newest'] as const

/** Upper bound for search page sizes (protects the upstream APIs). */
export const MAX_SEARCH_LIMIT = 100

/** Smallest accepted Java heap. */
export const MIN_HEAP_MB = 128

/** Largest accepted Java heap. */
export const MAX_HEAP_MB = 262_144

/** Longest accepted instance name. */
export const MAX_NAME_LENGTH = 64

/** Default window size used by the launcher wizard. */
export const DEFAULT_WINDOW: InstanceConfig['window'] = { width: 854, height: 480, fullscreen: false }

/** Default heap used when the client omits `memory`. */
export const DEFAULT_MEMORY: InstanceConfig['memory'] = { minMb: 512, maxMb: 4096 }

/** Anything that is a plain object. */
function isRecord(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value)
}

/** Require `value` to be a plain object. */
function asObject(value: unknown, label: string): JsonObject {
  if (!isRecord(value)) throw ApiError.validation(`字段 ${label} 必须是一个对象`)
  return value
}

/**
 * Parse a loader list such as `[{ kind: 'fabric', version: '0.16.9' }]`.
 *
 * `vanilla` entries are dropped: vanilla is represented by `gameVersion`
 * alone and must never appear as an installed loader.
 */
export function parseLoaderSpecs(value: unknown, label = 'loaders'): LoaderSpec[] {
  if (value === undefined || value === null) return []
  if (!Array.isArray(value)) throw ApiError.validation(`字段 ${label} 必须是数组`)
  const specs: LoaderSpec[] = []
  for (const [index, item] of value.entries()) {
    const entry = asObject(item, `${label}[${index}]`)
    const kind = enumValue(entry, 'kind', LOADER_KINDS, `${label}[${index}].kind`)
    if (!kind) throw ApiError.validation(`字段 ${label}[${index}].kind 不能为空`)
    if (kind === 'vanilla') continue
    const version = optionalString(entry, 'version', { label: `${label}[${index}].version` })
    specs.push(version ? { kind, version } : { kind })
  }
  return specs
}

/** Parse a heap configuration; enforces `minMb <= maxMb`. */
export function parseMemory(value: unknown, label = 'memory'): InstanceConfig['memory'] {
  if (value === undefined || value === null) return { ...DEFAULT_MEMORY }
  const record = asObject(value, label)
  const minMb = optionalInteger(record, 'minMb', { label: `${label}.minMb`, min: MIN_HEAP_MB, max: MAX_HEAP_MB })
  const maxMb = optionalInteger(record, 'maxMb', { label: `${label}.maxMb`, min: MIN_HEAP_MB, max: MAX_HEAP_MB })
  const memory = {
    minMb: minMb ?? DEFAULT_MEMORY.minMb,
    maxMb: maxMb ?? DEFAULT_MEMORY.maxMb,
  }
  if (memory.minMb > memory.maxMb) throw ApiError.validation('最小内存不能大于最大内存')
  return memory
}

/** Parse the window configuration. */
export function parseWindow(value: unknown, label = 'window'): InstanceConfig['window'] {
  if (value === undefined || value === null) return { ...DEFAULT_WINDOW }
  const record = asObject(value, label)
  return {
    width: optionalInteger(record, 'width', { label: `${label}.width`, min: 1, max: 16_384 }) ?? DEFAULT_WINDOW.width,
    height: optionalInteger(record, 'height', { label: `${label}.height`, min: 1, max: 16_384 }) ?? DEFAULT_WINDOW.height,
    fullscreen: optionalBoolean(record, 'fullscreen', `${label}.fullscreen`) ?? DEFAULT_WINDOW.fullscreen,
  }
}

/**
 * Parse a full `InstanceConfig` used by `POST /api/instances`.
 *
 * Only `name` and `gameVersion` are mandatory; everything else falls back to
 * the launcher defaults so the wizard can post incrementally.
 */
export function parseInstanceConfig(body: JsonObject): InstanceConfig {
  const config: InstanceConfig = {
    name: requiredString(body, 'name', { label: 'name', max: MAX_NAME_LENGTH }),
    gameVersion: requiredString(body, 'gameVersion', { label: 'gameVersion', max: 64 }),
    loaders: parseLoaderSpecs(body.loaders),
    memory: parseMemory(body.memory),
    jvmArgs: optionalStringArray(body, 'jvmArgs') ?? [],
    gameArgs: optionalStringArray(body, 'gameArgs') ?? [],
    window: parseWindow(body.window),
  }
  const javaPath = optionalString(body, 'javaPath')
  if (javaPath) config.javaPath = javaPath
  const icon = optionalString(body, 'icon')
  if (icon) config.icon = icon
  const notes = optionalString(body, 'notes', { max: 2000 })
  if (notes) config.notes = notes
  return config
}

/**
 * Parse a partial `InstanceConfig` used by `PATCH /api/instances/:id`.
 *
 * Only the keys present in the body are returned, so an empty patch is legal
 * (it simply returns the instance unchanged).
 */
export function parseInstancePatch(body: JsonObject): Partial<InstanceConfig> {
  const patch: Partial<InstanceConfig> = {}
  if ('name' in body) patch.name = requiredString(body, 'name', { label: 'name', max: MAX_NAME_LENGTH })
  if ('gameVersion' in body) patch.gameVersion = requiredString(body, 'gameVersion', { label: 'gameVersion', max: 64 })
  if ('loaders' in body) patch.loaders = parseLoaderSpecs(body.loaders)
  if ('memory' in body) patch.memory = parseMemory(body.memory)
  if ('jvmArgs' in body) patch.jvmArgs = optionalStringArray(body, 'jvmArgs') ?? []
  if ('gameArgs' in body) patch.gameArgs = optionalStringArray(body, 'gameArgs') ?? []
  if ('window' in body) patch.window = parseWindow(body.window)
  if ('javaPath' in body) patch.javaPath = optionalString(body, 'javaPath', { allowEmpty: true }) ?? ''
  if ('icon' in body) patch.icon = optionalString(body, 'icon', { allowEmpty: true })
  if ('notes' in body) patch.notes = optionalString(body, 'notes', { max: 2000, allowEmpty: true })
  if (patch.memory && patch.memory.minMb > patch.memory.maxMb) throw ApiError.validation('最小内存不能大于最大内存')
  return patch
}

/** Parse `POST /api/launch`. */
export function parseLaunchRequest(body: JsonObject): LaunchRequest {
  const request: LaunchRequest = {
    instanceId: requiredString(body, 'instanceId', { label: 'instanceId', max: 128 }),
    accountId: requiredString(body, 'accountId', { label: 'accountId', max: 128 }),
  }
  const memoryMb = optionalInteger(body, 'memoryMb', { label: 'memoryMb', min: MIN_HEAP_MB, max: MAX_HEAP_MB })
  if (memoryMb !== undefined) request.memoryMb = memoryMb
  const javaPath = optionalString(body, 'javaPath')
  if (javaPath) request.javaPath = javaPath
  const extraJvmArgs = optionalStringArray(body, 'extraJvmArgs')
  if (extraJvmArgs) request.extraJvmArgs = extraJvmArgs
  const extraGameArgs = optionalStringArray(body, 'extraGameArgs')
  if (extraGameArgs) request.extraGameArgs = extraGameArgs
  const detach = optionalBoolean(body, 'detach')
  if (detach !== undefined) request.detach = detach
  return request
}

/**
 * Parse the `GET /api/market/search` query string.
 *
 * `source` is the only mandatory parameter; `query` defaults to an empty
 * string (browse mode) and `limit` is clamped to {@link MAX_SEARCH_LIMIT}.
 */
export function parseMarketSearch(url: URL): MarketSearchInput {
  const params = url.searchParams
  const source = params.get('source') ?? 'modrinth'
  if (!(MARKET_SOURCES as readonly string[]).includes(source)) {
    throw ApiError.validation(`查询参数 source 必须是以下之一：${MARKET_SOURCES.join(' / ')}`)
  }
  const input: MarketSearchInput = {
    source: source as MarketSearchInput['source'],
    query: (params.get('query') ?? params.get('q') ?? '').trim(),
  }
  const projectType = params.get('projectType') ?? params.get('type') ?? undefined
  if (projectType) {
    if (!(PROJECT_TYPES as readonly string[]).includes(projectType)) {
      throw ApiError.validation(`查询参数 projectType 必须是以下之一：${PROJECT_TYPES.join(' / ')}`)
    }
    input.projectType = projectType as ProjectType
  }
  const gameVersion = params.get('gameVersion')?.trim()
  if (gameVersion) input.gameVersion = gameVersion
  const loader = params.get('loader')?.trim()
  if (loader) input.loader = loader
  const offset = queryInteger(params.get('offset') ?? undefined, 'offset', { min: 0, fallback: 0 })
  if (offset !== undefined) input.offset = offset
  const limit = queryInteger(params.get('limit') ?? undefined, 'limit', { min: 1, max: MAX_SEARCH_LIMIT, fallback: 20 })
  if (limit !== undefined) input.limit = limit
  const sort = params.get('sort') ?? undefined
  if (sort) {
    if (!(MARKET_SORTS as readonly string[]).includes(sort)) {
      throw ApiError.validation(`查询参数 sort 必须是以下之一：${MARKET_SORTS.join(' / ')}`)
    }
    input.sort = sort as MarketSearchInput['sort']
  }
  return input
}

/**
 * Coerce a posted marketplace version into `MarketVersion`.
 *
 * The UI round-trips an object it previously received from
 * `GET /api/market/:source/:id/versions`; only the identity and the download
 * target are strictly required, the rest is defaulted so a leaner client (or
 * a future one) keeps working.
 */
export function parseMarketVersion(value: unknown): MarketVersion {
  const record = asObject(value, 'version')
  const source = enumValue(record, 'source', MARKET_SOURCES, 'version.source')
  if (!source) throw ApiError.validation('字段 version.source 不能为空')
  const file = record.file
  if (!isRecord(file)) throw ApiError.validation('字段 version.file 必须是一个对象')
  const url = optionalString(file, 'url', { trim: false })
  if (!url) throw ApiError.validation('字段 version.file.url 不能为空')
  const fileName = optionalString(file, 'fileName', { trim: false })
  if (!fileName) throw ApiError.validation('字段 version.file.fileName 不能为空')
  const gameVersions = optionalStringArray(record, 'gameVersions') ?? []
  const loaders = optionalStringArray(record, 'loaders') ?? []
  return {
    source,
    id: requiredString(record, 'id', { label: 'version.id', max: 128 }),
    projectId: optionalString(record, 'projectId') ?? '',
    name: optionalString(record, 'name') ?? fileName,
    versionNumber: optionalString(record, 'versionNumber') ?? '',
    releaseType: (enumValue(record, 'releaseType', ['release', 'beta', 'alpha'] as const, 'version.releaseType') ?? 'release'),
    gameVersions,
    loaders,
    downloads: optionalInteger(record, 'downloads', { label: 'version.downloads', min: 0 }) ?? 0,
    publishedAt: optionalString(record, 'publishedAt') ?? new Date(0).toISOString(),
    file: { url, fileName, size: optionalInteger(file, 'size', { label: 'version.file.size', min: 0 }) ?? 0 },
    dependencies: [],
  }
}

/** Settings keys the HTTP layer accepts in a `PATCH /api/settings` body. */
export const SETTINGS_KEYS = [
  'language', 'dataDir', 'concurrency', 'mirrors', 'proxy', 'autoDownloadJava',
  'keepLogs', 'showSnapshots', 'downloadSource', 'theme', 'curseforgeApiKey',
] as const satisfies readonly (keyof Settings)[]

/**
 * Parse a `PATCH /api/settings` body.
 *
 * Unknown keys are rejected instead of silently ignored: a typo in the UI that
 * looks saved but is not is worse than an explicit 400.
 */
export function parseSettingsPatch(body: JsonObject): Partial<Settings> {
  const patch: Partial<Settings> = {}
  for (const key of Object.keys(body)) {
    if (!(SETTINGS_KEYS as readonly string[]).includes(key)) {
      throw ApiError.validation(`未知的设置项：${key}`)
    }
  }
  if ('language' in body) {
    patch.language = enumValue(body, 'language', ['zh-CN', 'en-US'] as const, 'language') ?? 'zh-CN'
  }
  if ('dataDir' in body) patch.dataDir = optionalString(body, 'dataDir', { allowEmpty: true, trim: false }) ?? null
  if ('concurrency' in body) {
    patch.concurrency = optionalInteger(body, 'concurrency', { label: 'concurrency', min: 1, max: 64 })
  }
  if ('mirrors' in body) {
    const mirrors = asObject(body.mirrors, 'mirrors')
    patch.mirrors = { ...(mirrors as unknown as Settings['mirrors']) }
  }
  if ('proxy' in body) {
    if (body.proxy === null) {
      patch.proxy = undefined
    } else {
      const proxy = asObject(body.proxy, 'proxy')
      patch.proxy = {
        enabled: optionalBoolean(proxy, 'enabled', 'proxy.enabled') ?? false,
        host: optionalString(proxy, 'host') ?? '',
        port: optionalInteger(proxy, 'port', { label: 'proxy.port', min: 1, max: 65_535 }) ?? 8080,
        ...(optionalString(proxy, 'username') ? { username: optionalString(proxy, 'username') } : {}),
        ...(optionalString(proxy, 'password') ? { password: optionalString(proxy, 'password') } : {}),
      }
    }
  }
  if ('autoDownloadJava' in body) {
    patch.autoDownloadJava = optionalBoolean(body, 'autoDownloadJava', 'autoDownloadJava') ?? false
  }
  if ('keepLogs' in body) patch.keepLogs = optionalInteger(body, 'keepLogs', { label: 'keepLogs', min: 0, max: 500 })
  if ('showSnapshots' in body) patch.showSnapshots = optionalBoolean(body, 'showSnapshots', 'showSnapshots') ?? false
  if ('downloadSource' in body) {
    patch.downloadSource = enumValue(body, 'downloadSource', ['official', 'mirror'] as const, 'downloadSource') ?? 'official'
  }
  if ('theme' in body) patch.theme = enumValue(body, 'theme', ['archive', 'midnight', 'light'] as const, 'theme') ?? 'archive'
  if ('curseforgeApiKey' in body) patch.curseforgeApiKey = optionalString(body, 'curseforgeApiKey', { allowEmpty: true })
  return patch
}
