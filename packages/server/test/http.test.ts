/**
 * Unit tests for the hand written validators and the error mapping.
 *
 * These are the "rules" the server owns (the business rules live in core), so
 * they get their own coverage instead of only being exercised through routes.
 */
import { describe, expect, it } from 'vitest'
import {
  ApiError, enumValue, optionalBoolean, optionalInteger, optionalString, optionalStringArray,
  queryInteger, readJsonObject, requiredString, toApiError,
} from '../src/http.ts'

/** Build a request with a JSON body. */
function jsonRequest(body: string): Request {
  return new Request('http://localhost/api/x', { method: 'POST', body })
}

describe('toApiError', () => {
  it('maps an ApiError to its own status and code', () => {
    const result = toApiError(ApiError.notFound('实例不存在：a'))
    expect(result.status).toBe(404)
    expect(result.body).toEqual({ code: 'NOT_FOUND', message: '实例不存在：a' })
  })

  it('maps a Validation ApiError to 400', () => {
    const result = toApiError(ApiError.validation('字段 name 不能为空'))
    expect(result.status).toBe(400)
    expect(result.body.code).toBe('VALIDATION_ERROR')
  })

  it('maps a NotFoundError by name', () => {
    const error = new Error('找不到')
    error.name = 'NotFoundError'
    expect(toApiError(error).status).toBe(404)
  })

  it('maps a ValidationError by name', () => {
    const error = new Error('参数不对')
    error.name = 'ValidationError'
    expect(toApiError(error).status).toBe(400)
  })

  it('falls back to 500 for an ordinary error', () => {
    const result = toApiError(new Error('炸了'))
    expect(result.status).toBe(500)
    expect(result.body).toEqual({ code: 'INTERNAL_ERROR', message: '炸了' })
  })

  it('never leaks an empty message', () => {
    expect(toApiError(new Error('')).body.message).toBe('服务器内部错误')
    expect(toApiError(undefined).body.message).toBe('服务器内部错误')
  })

  it('accepts a non-Error throwable', () => {
    expect(toApiError('磁盘只读').body.message).toBe('磁盘只读')
  })

  it('honours an explicit numeric status field', () => {
    const error = Object.assign(new Error('配额不足'), { status: 429 })
    expect(toApiError(error).status).toBe(429)
    expect(toApiError(error).body.code).toBe('TOO_MANY_REQUESTS')
  })

  it('carries detail without duplicating the message', () => {
    const result = toApiError(new Error('外层', { cause: new Error('底层原因') }))
    expect(result.body.detail).toBe('底层原因')
  })

  it('keeps an UPPER_SNAKE code from the error object', () => {
    const error = Object.assign(new Error('冲突'), { status: 409, code: 'NAME_TAKEN' })
    expect(toApiError(error).body.code).toBe('NAME_TAKEN')
  })
})

describe('readJsonObject', () => {
  it('parses a valid object', async () => {
    await expect(readJsonObject(jsonRequest('{"a":1}'))).resolves.toEqual({ a: 1 })
  })

  it('rejects an empty body', async () => {
    await expect(readJsonObject(jsonRequest(''))).rejects.toThrow('不能为空')
  })

  it('rejects malformed JSON', async () => {
    await expect(readJsonObject(jsonRequest('{oops'))).rejects.toThrow('合法的 JSON')
  })

  it('rejects an array body', async () => {
    await expect(readJsonObject(jsonRequest('[1,2]'))).rejects.toThrow('JSON 对象')
  })

  it('rejects a scalar body', async () => {
    await expect(readJsonObject(jsonRequest('42'))).rejects.toThrow('JSON 对象')
  })
})

describe('requiredString', () => {
  it('returns the trimmed value', () => {
    expect(requiredString({ name: '  Alex  ' }, 'name')).toBe('Alex')
  })

  it('rejects a missing field', () => {
    expect(() => requiredString({}, 'name')).toThrow('缺少必填字段')
  })

  it('rejects a non-string field', () => {
    expect(() => requiredString({ name: 1 }, 'name')).toThrow('必须是字符串')
  })

  it('rejects an empty string', () => {
    expect(() => requiredString({ name: '   ' }, 'name')).toThrow('不能为空')
  })

  it('enforces the length ceiling', () => {
    expect(() => requiredString({ name: 'abcdef' }, 'name', { max: 3 })).toThrow('不能超过 3')
  })
})

describe('optionalString', () => {
  it('returns undefined for an absent field', () => {
    expect(optionalString({}, 'x')).toBeUndefined()
  })

  it('returns undefined for an empty value by default', () => {
    expect(optionalString({ x: '  ' }, 'x')).toBeUndefined()
  })

  it('keeps an empty value when allowEmpty is set', () => {
    expect(optionalString({ x: '' }, 'x', { allowEmpty: true })).toBe('')
  })

  it('keeps whitespace when trim is disabled', () => {
    expect(optionalString({ x: ' a ' }, 'x', { trim: false })).toBe(' a ')
  })

  it('rejects a wrong type', () => {
    expect(() => optionalString({ x: 1 }, 'x')).toThrow('必须是字符串')
  })
})

describe('optionalInteger / queryInteger', () => {
  it('parses an integer in range', () => {
    expect(optionalInteger({ n: 8 }, 'n', { min: 1, max: 16 })).toBe(8)
  })

  it('rejects a non-integer number', () => {
    expect(() => optionalInteger({ n: 1.5 }, 'n')).toThrow('必须是整数')
  })

  it('rejects a value above the ceiling', () => {
    expect(() => optionalInteger({ n: 99 }, 'n', { max: 16 })).toThrow('不能大于 16')
  })

  it('parses a query integer and applies the fallback', () => {
    expect(queryInteger('24', 'limit')).toBe(24)
    expect(queryInteger(undefined, 'limit', { fallback: 20 })).toBe(20)
    expect(queryInteger('', 'limit', { fallback: 5 })).toBe(5)
  })

  it('rejects a non-numeric query value', () => {
    expect(() => queryInteger('abc', 'limit')).toThrow('必须是整数')
  })

  it('rejects an out-of-range query value', () => {
    expect(() => queryInteger('0', 'limit', { min: 1 })).toThrow('不能小于 1')
  })
})

describe('optionalBoolean / optionalStringArray / enumValue', () => {
  it('parses a boolean', () => {
    expect(optionalBoolean({ b: true }, 'b')).toBe(true)
    expect(optionalBoolean({}, 'b')).toBeUndefined()
  })

  it('rejects a non-boolean', () => {
    expect(() => optionalBoolean({ b: 'true' }, 'b')).toThrow('必须是布尔值')
  })

  it('parses a string array', () => {
    expect(optionalStringArray({ args: ['-Xmx2G'] }, 'args')).toEqual(['-Xmx2G'])
  })

  it('rejects a non-array', () => {
    expect(() => optionalStringArray({ args: '-Xmx2G' }, 'args')).toThrow('必须是字符串数组')
  })

  it('rejects a non-string item and names its position', () => {
    expect(() => optionalStringArray({ args: ['a', 2] }, 'args')).toThrow('第 2 项')
  })

  it('accepts an allowed enum literal', () => {
    expect(enumValue({ k: 'fabric' }, 'k', ['fabric', 'quilt'] as const)).toBe('fabric')
  })

  it('rejects a value outside the enum and lists the options', () => {
    expect(() => enumValue({ k: 'nope' }, 'k', ['fabric', 'quilt'] as const)).toThrow('fabric / quilt')
  })
})
