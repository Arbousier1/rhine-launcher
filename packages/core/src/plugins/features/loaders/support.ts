/**
 * Request decoding and validation shared by the loader feature plugins.
 *
 * Each plugin still owns exactly one action; this module only turns HTTP
 * requests (query/body/path params) into typed inputs and produces 400-class
 * FeatureErrors with Chinese messages.
 */
import { FeatureError } from '@rhine/plugin-api'

/** Validated list input. */
export interface LoaderListInput {
  gameVersion: string
}

/** Validated install input. */
export interface LoaderInstallInput extends LoaderListInput {
  loaderVersion: string
}

/** Decode the gameVersion query parameter of a list endpoint. */
export function decodeListInput(request: Request): LoaderListInput {
  const gameVersion = new URL(request.url).searchParams.get('gameVersion') ?? ''
  return { gameVersion: requireGameVersion(gameVersion) }
}

/** Decode a JSON install body. */
export async function decodeInstallInput(request: Request): Promise<LoaderInstallInput> {
  let body: unknown
  try {
    const text = await request.text()
    body = text.trim() ? JSON.parse(text) : {}
  } catch {
    throw new FeatureError('VALIDATION_ERROR', '安装请求不是合法的 JSON', 400)
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new FeatureError('VALIDATION_ERROR', '安装请求必须是一个 JSON 对象', 400)
  }
  const record = body as Record<string, unknown>
  return {
    gameVersion: requireGameVersion(record.gameVersion),
    loaderVersion: requireLoaderVersion(record.loaderVersion),
  }
}

/** Decode the :gameVersion path parameter of the detect endpoint. */
export function decodeDetectInput(
  request: Request,
  params: Record<string, string> = {},
): LoaderListInput {
  const fromParams = typeof params?.gameVersion === 'string' ? params.gameVersion : ''
  if (fromParams) return { gameVersion: requireGameVersion(fromParams) }
  const match = /\/api\/versions\/([^/]+)\/loaders$/.exec(new URL(request.url).pathname)
  return { gameVersion: requireGameVersion(match ? decodeURIComponent(match[1]) : '') }
}

/** Validate a game version coming from a direct feature call. */
export function requireGameVersion(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FeatureError('VALIDATION_ERROR', '缺少游戏版本 gameVersion', 400)
  }
  return value.trim()
}

/** Validate a loader version coming from a direct feature call. */
export function requireLoaderVersion(value: unknown): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new FeatureError('VALIDATION_ERROR', '缺少加载器版本 loaderVersion', 400)
  }
  return value.trim()
}

/** Validate an install input object. */
export function requireInstallInput(input: unknown): LoaderInstallInput {
  const record = (input ?? {}) as Record<string, unknown>
  return {
    gameVersion: requireGameVersion(record.gameVersion),
    loaderVersion: requireLoaderVersion(record.loaderVersion),
  }
}

/** Validate a list input object. */
export function requireListInput(input: unknown): LoaderListInput {
  const record = (input ?? {}) as Record<string, unknown>
  return { gameVersion: requireGameVersion(record.gameVersion) }
}
