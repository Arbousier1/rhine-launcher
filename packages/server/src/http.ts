/**
 * HTTP plumbing shared by the REST routes and the WebSocket hub.
 *
 * Three concerns live here:
 *  - {@link ApiError} + the status mapping from domain errors to HTTP codes,
 *  - the uniform `{ code, message, detail? }` JSON error envelope,
 *  - the tiny hand rolled request body validators (no extra dependency).
 */

/** Error envelope described by `ApiError` in `@rhine/core`. */
export interface ApiErrorBody {
  code: string
  message: string
  detail?: string
}

/** HTTP status used when a domain error is either missing or unrecognised. */
export const INTERNAL_ERROR_STATUS = 500

/**
 * Transport-agnostic error carrying an HTTP status.
 *
 * Handlers throw these instead of building responses so that the global
 * `onError` hook stays the single place that renders the envelope.
 */
export class ApiError extends Error {
  readonly code: string
  readonly status: number
  readonly detail?: string

  constructor(status: number, code: string, message: string, detail?: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.detail = detail
  }

  /** Build the `{ code, message, detail? }` body sent to the client. */
  toBody(): ApiErrorBody {
    const body: ApiErrorBody = { code: this.code, message: this.message }
    if (this.detail !== undefined) body.detail = this.detail
    return body
  }

  /** 400 for malformed request payloads. */
  static validation(message: string, detail?: string): ApiError {
    return new ApiError(400, 'VALIDATION_ERROR', message, detail)
  }

  /** 404 for unknown ids. */
  static notFound(message: string, detail?: string): ApiError {
    return new ApiError(404, 'NOT_FOUND', message, detail)
  }

  /** 409 for conflicting state (port in use, duplicate name, ...). */
  static conflict(message: string, detail?: string): ApiError {
    return new ApiError(409, 'CONFLICT', message, detail)
  }

  /** 503 for a capability the current runtime does not expose. */
  static unavailable(message: string, detail?: string): ApiError {
    return new ApiError(503, 'SERVICE_UNAVAILABLE', message, detail)
  }
}

/** Read `name` off an unknown value without trusting its shape. */
function readString(source: unknown, name: string): string | undefined {
  if (!source || typeof source !== 'object') return undefined
  const value = (source as Record<string, unknown>)[name]
  return typeof value === 'string' ? value : undefined
}

/** Read a numeric `code`/`status` field. */
function readCode(source: unknown): number | undefined {
  if (!source || typeof source !== 'object') return undefined
  const record = source as Record<string, unknown>
  for (const key of ['status', 'statusCode', 'httpStatus']) {
    const value = record[key]
    if (typeof value === 'number' && Number.isInteger(value) && value >= 100 && value <= 599) return value
  }
  return undefined
}

/** Recover the HTTP status a thrown domain error asks for. */
function statusOf(error: unknown): number {
  if (error instanceof ApiError) return error.status
  const explicit = readCode(error)
  if (explicit !== undefined) return explicit
  if (error instanceof Error) {
    // `ServiceNotFound` style errors mean the launcher is not fully assembled.
    if (/not registered|not found/i.test(error.message) && /service/i.test(error.message)) {
      return ApiError.unavailable('服务尚未就绪').status
    }
    switch (error.name) {
      case 'NotFoundError':
      case 'NotFound':
        return 404
      case 'ValidationError':
      case 'Validation':
      case 'InvalidArgumentError':
        return 400
      case 'AbortError':
        return 499
      default:
        break
    }
  }
  return INTERNAL_ERROR_STATUS
}

/** Default machine readable code per HTTP status. */
function codeOf(status: number): string {
  switch (status) {
    case 400: return 'VALIDATION_ERROR'
    case 401: return 'UNAUTHORIZED'
    case 403: return 'FORBIDDEN'
    case 404: return 'NOT_FOUND'
    case 405: return 'METHOD_NOT_ALLOWED'
    case 409: return 'CONFLICT'
    case 422: return 'UNPROCESSABLE_ENTITY'
    case 429: return 'TOO_MANY_REQUESTS'
    case 499: return 'CANCELLED'
    case 503: return 'SERVICE_UNAVAILABLE'
    default: return status >= 500 ? 'INTERNAL_ERROR' : 'REQUEST_FAILED'
  }
}

/** Chinese fallback when a domain error carries no usable message. */
function messageOf(error: unknown): string {
  const text = typeof error === 'string'
    ? error
    : error instanceof Error ? error.message : ''
  if (!text.trim()) return '服务器内部错误'
  // 非中文技术错误也照原样回显，方便用户/开发者定位；只有空消息才替换。
  return text
}

/** Extract a stack/technical detail for the `detail` field (never the message). */
function detailOf(error: unknown): string | undefined {
  if (readString(error, 'detail')) return readString(error, 'detail')
  if (error instanceof Error && error.cause instanceof Error && error.cause.message) {
    return error.cause.message
  }
  return undefined
}

/**
 * Convert any thrown value into the uniform JSON error envelope.
 *
 * NotFound → 404, Validation → 400, everything else → 500, exactly as the
 * architecture document requires.
 */
export function toApiError(error: unknown): { status: number; body: ApiErrorBody } {
  const status = statusOf(error)
  const name = readString(error, 'code')
  const code = name && /^[A-Z][A-Z0-9_]*$/.test(name) ? name : codeOf(status)
  const body: ApiErrorBody = { code, message: messageOf(error) }
  const detail = detailOf(error)
  if (detail) body.detail = detail
  return { status, body }
}

/* ------------------------------------------------------------------ */
/* request body validators                                             */
/* ------------------------------------------------------------------ */

/** A JSON object body. */
export type JsonObject = Record<string, unknown>

/**
 * Read the request body as a JSON object.
 *
 * @param request — the fetch style request from the hono context.
 * @param label — Chinese noun used in the error message ("请求体").
 * @returns the parsed object.
 * @throws ApiError 400 when the body is missing, not JSON, or not an object.
 */
export async function readJsonObject(request: Request, label = '请求体'): Promise<JsonObject> {
  let text = ''
  try {
    text = await request.text()
  } catch (error) {
    throw ApiError.validation(`${label}读取失败`, String(error))
  }
  if (!text.trim()) throw ApiError.validation(`${label}不能为空`)
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw ApiError.validation(`${label}不是合法的 JSON`)
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw ApiError.validation(`${label}必须是一个 JSON 对象`)
  }
  return parsed as JsonObject
}

/** Options accepted by {@link requiredString}. */
export interface StringOptions {
  /** Field name used in the error message. */
  label?: string
  /** Trim the value before validating (default: true). */
  trim?: boolean
  /** Reject empty strings (default: true). */
  allowEmpty?: boolean
  /** Maximum accepted length in characters. */
  max?: number
}

/**
 * Validate a required string field.
 *
 * @throws ApiError 400 with a Chinese message when the field is missing/invalid.
 */
export function requiredString(source: JsonObject, key: string, options: StringOptions = {}): string {
  const label = options.label ?? key
  const raw = source[key]
  if (raw === undefined || raw === null) throw ApiError.validation(`缺少必填字段：${label}`)
  if (typeof raw !== 'string') throw ApiError.validation(`字段 ${label} 必须是字符串`)
  const value = options.trim === false ? raw : raw.trim()
  if (value.length === 0 && options.allowEmpty !== true) throw ApiError.validation(`字段 ${label} 不能为空`)
  if (options.max !== undefined && value.length > options.max) {
    throw ApiError.validation(`字段 ${label} 长度不能超过 ${options.max} 个字符`)
  }
  return value
}

/**
 * Validate an optional string field.
 *
 * @returns the trimmed value, or `undefined` when the field is absent/null/empty.
 */
export function optionalString(source: JsonObject, key: string, options: StringOptions = {}): string | undefined {
  const raw = source[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string') throw ApiError.validation(`字段 ${options.label ?? key} 必须是字符串`)
  const value = options.trim === false ? raw : raw.trim()
  if (value.length === 0 && options.allowEmpty !== true) return undefined
  if (options.max !== undefined && value.length > options.max) {
    throw ApiError.validation(`字段 ${options.label ?? key} 长度不能超过 ${options.max} 个字符`)
  }
  return value
}

/** Validate an optional boolean field. */
export function optionalBoolean(source: JsonObject, key: string, label = key): boolean | undefined {
  const raw = source[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'boolean') throw ApiError.validation(`字段 ${label} 必须是布尔值`)
  return raw
}

/** Validate an optional integer field inside an inclusive range. */
export function optionalInteger(
  source: JsonObject,
  key: string,
  options: { label?: string; min?: number; max?: number } = {},
): number | undefined {
  const label = options.label ?? key
  const raw = source[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'number' || !Number.isFinite(raw) || !Number.isInteger(raw)) {
    throw ApiError.validation(`字段 ${label} 必须是整数`)
  }
  if (options.min !== undefined && raw < options.min) throw ApiError.validation(`字段 ${label} 不能小于 ${options.min}`)
  if (options.max !== undefined && raw > options.max) throw ApiError.validation(`字段 ${label} 不能大于 ${options.max}`)
  return raw
}

/** Validate an optional integer field given as a query string. */
export function queryInteger(
  value: string | undefined,
  name: string,
  options: { min?: number; max?: number; fallback?: number } = {},
): number | undefined {
  if (value === undefined || value === '') return options.fallback
  if (!/^-?\d+$/.test(value.trim())) throw ApiError.validation(`查询参数 ${name} 必须是整数`)
  const parsed = Number.parseInt(value, 10)
  if (options.min !== undefined && parsed < options.min) {
    throw ApiError.validation(`查询参数 ${name} 不能小于 ${options.min}`)
  }
  if (options.max !== undefined && parsed > options.max) {
    throw ApiError.validation(`查询参数 ${name} 不能大于 ${options.max}`)
  }
  return parsed
}

/** Validate an optional string array field (e.g. extra JVM args). */
export function optionalStringArray(source: JsonObject, key: string, label = key): string[] | undefined {
  const raw = source[key]
  if (raw === undefined || raw === null) return undefined
  if (!Array.isArray(raw)) throw ApiError.validation(`字段 ${label} 必须是字符串数组`)
  return raw.map((item, index) => {
    if (typeof item !== 'string') throw ApiError.validation(`字段 ${label} 的第 ${index + 1} 项必须是字符串`)
    return item
  })
}

/** Ensure a discriminated field is one of the allowed literals. */
export function enumValue<T extends string>(
  source: JsonObject,
  key: string,
  allowed: readonly T[],
  label = key,
): T | undefined {
  const raw = source[key]
  if (raw === undefined || raw === null) return undefined
  if (typeof raw !== 'string' || !allowed.includes(raw as T)) {
    throw ApiError.validation(`字段 ${label} 必须是以下之一：${allowed.join(' / ')}`)
  }
  return raw as T
}
