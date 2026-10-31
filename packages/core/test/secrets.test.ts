import { afterEach, describe, expect, it } from 'vitest'
import {
  SECRET_ENV, envValue, resolveCurseforgeApiKey, resolveMicrosoftClientId, resolveSecret,
} from '../src/config/secrets.ts'
import { microsoftConfiguration, normalizeMicrosoftAuthority } from '../src/accounts/config.ts'

const saved: Record<string, string | undefined> = {}
function setEnv(name: string, value: string | undefined): void {
  if (!(name in saved)) saved[name] = process.env[name]
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
afterEach(() => {
  for (const [name, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
    delete saved[name]
  }
})

const GUID = 'c0161cf4-3180-4a1a-919b-19f75d039d32'

describe('credential resolution', () => {
  it('treats blank environment values as unset', () => {
    setEnv('RHINE_TEST_BLANK', '   ')
    expect(envValue('RHINE_TEST_BLANK')).toBeUndefined()
    setEnv('RHINE_TEST_BLANK', undefined)
    expect(envValue('RHINE_TEST_BLANK')).toBeUndefined()
  })

  it('prefers the environment over persisted settings', () => {
    setEnv(SECRET_ENV.curseforgeApiKey, '$2a$10$fromEnvironment')
    expect(resolveCurseforgeApiKey('$2a$10$fromSettings')).toEqual({
      value: '$2a$10$fromEnvironment',
      origin: 'env',
    })
  })

  it('falls back to settings when the environment is unset', () => {
    setEnv(SECRET_ENV.curseforgeApiKey, undefined)
    expect(resolveCurseforgeApiKey('  $2a$10$fromSettings  ')).toEqual({
      value: '$2a$10$fromSettings',
      origin: 'settings',
    })
  })

  it('reports an empty configuration as origin none', () => {
    setEnv(SECRET_ENV.curseforgeApiKey, undefined)
    expect(resolveCurseforgeApiKey(undefined)).toEqual({ value: undefined, origin: 'none' })
    expect(resolveCurseforgeApiKey('')).toEqual({ value: undefined, origin: 'none' })
  })

  it('does not let a blank env var erase a configured setting', () => {
    setEnv(SECRET_ENV.microsoftClientId, '')
    expect(resolveMicrosoftClientId(GUID)).toEqual({ value: GUID, origin: 'settings' })
  })

  it('resolves the generic helper the same way', () => {
    setEnv('RHINE_TEST_SECRET', 'abc')
    expect(resolveSecret('RHINE_TEST_SECRET', 'def')).toEqual({ value: 'abc', origin: 'env' })
    setEnv('RHINE_TEST_SECRET', undefined)
    expect(resolveSecret('RHINE_TEST_SECRET', 'def')).toEqual({ value: 'def', origin: 'settings' })
  })
})

describe('microsoft configuration precedence', () => {
  it('uses the environment client id when settings are empty', () => {
    setEnv(SECRET_ENV.microsoftClientId, GUID)
    expect(microsoftConfiguration({}, { microsoftClientId: '' }).clientId).toBe(GUID)
  })

  it('lets an explicit request value win over the environment', () => {
    setEnv(SECRET_ENV.microsoftClientId, GUID)
    const other = '11111111-1111-4111-8111-111111111111'
    expect(microsoftConfiguration({ clientId: other }, {})).toEqual({
      clientId: other,
      authority: 'https://login.microsoftonline.com/consumers/oauth2/v2.0',
    })
  })

  it('throws a configuration error instead of borrowing another app', () => {
    setEnv(SECRET_ENV.microsoftClientId, undefined)
    expect(() => microsoftConfiguration({}, {})).toThrow(/RHINE_MICROSOFT_CLIENT_ID/)
  })

  it('rejects a non-GUID client id', () => {
    setEnv(SECRET_ENV.microsoftClientId, undefined)
    expect(() => microsoftConfiguration({ clientId: 'not-a-guid' }, {})).toThrow(/GUID/)
  })

  it('reads the authority from the environment and still locks it to Microsoft', () => {
    setEnv(SECRET_ENV.microsoftClientId, GUID)
    setEnv(SECRET_ENV.microsoftAuthority, 'organizations')
    expect(microsoftConfiguration({}, {}).authority)
      .toBe('https://login.microsoftonline.com/organizations/oauth2/v2.0')
    expect(() => normalizeMicrosoftAuthority('https://evil.example/consumers/oauth2/v2.0'))
      .toThrow(/login\.microsoftonline\.com/)
  })
})
