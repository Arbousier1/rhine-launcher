import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeatureRuntime, defineFeature } from '@rhine/plugin-api'
import { AccountError } from '../src/accounts/errors.ts'
import { recordMicrosoftFailure, clearMicrosoftFailure } from '../src/accounts/auth-diagnostics.ts'
import { BUILTIN_MICROSOFT_APP } from '../src/accounts/builtin-app.ts'
import diagnostic from '../src/plugins/features/auth/microsoft-diagnostics.plugin.ts'
import { dispatchFeature } from '../../server/src/plugin-http.ts'

afterEach(() => { vi.unstubAllGlobals() })
const CONFIG = { clientId: BUILTIN_MICROSOFT_APP.clientId, authority: BUILTIN_MICROSOFT_APP.authority }

describe('single-capability Microsoft failure diagnostics', () => {
  it('preserves safe metadata while discarding raw messages, unknown codes and credentials', async () => {
    const runtime = new FeatureRuntime()
    runtime.register(diagnostic)
    // A fixture writer uses the same context-local diagnostic store as complete/refresh.
    runtime.register(defineFeature<unknown, void>({ id: 'fixture.result', capability: 'fixture.result', title: 'Fixture only', execute(error, env) {
      if (error === null) clearMicrosoftFailure(env)
      else recordMicrosoftFailure(env, error, CONFIG)
    } }))
    await runtime.start()
    try {
      const network = vi.fn(() => { throw new Error('No network permitted') })
      vi.stubGlobal('fetch', network)
      expect(runtime.call(diagnostic.id)).toEqual({ lastFailure: null })
      runtime.call('fixture.result', new AccountError('Hostile echo: secret-ms secret-xsts', 'MINECRAFT_APP_NOT_APPROVED', {
        diagnostic: { stage: 'minecraft-login', upstreamStatus: 403, providerCode: 'ForbiddenOperationException' },
      }))
      const response = await dispatchFeature(runtime, new Request('http://127.0.0.1/api/accounts/microsoft/diagnostics'))
      const value = await response.json()
      expect(value).toMatchObject({ lastFailure: { code: 'MINECRAFT_APP_NOT_APPROVED', stage: 'minecraft-login', upstreamStatus: 403, providerCode: 'ForbiddenOperationException', application: 'builtin' } })
      expect(JSON.stringify(value)).not.toMatch(/secret-|identityToken|deviceCode|accessToken|refreshToken|uhs|xuid|Authorization/)
      expect(JSON.stringify(value)).not.toContain(CONFIG.clientId)
      runtime.call('fixture.result', new AccountError('secret-echo', 'secret-unknown-code', { diagnostic: { stage: 'xsts', upstreamStatus: 500 } }))
      expect(runtime.call(diagnostic.id)).toEqual(value)
      runtime.call('fixture.result', new AccountError('waiting', 'authorization_pending'))
      expect(runtime.call(diagnostic.id)).toEqual(value)
      runtime.call('fixture.result', null)
      expect(runtime.call(diagnostic.id)).toEqual({ lastFailure: null })
      expect(network).not.toHaveBeenCalled()
    } finally { await runtime.dispose() }
  })

  it('can be enabled without starting login or modifying settings', async () => {
    const runtime = new FeatureRuntime()
    runtime.register(diagnostic)
    await runtime.start()
    try {
      expect(diagnostic.capability).toBe(diagnostic.id)
      expect(diagnostic.http?.method).toBe('GET')
      expect(runtime.has('auth.microsoft.begin')).toBe(false)
      expect(runtime.has('settings.update')).toBe(false)
      expect(runtime.call(diagnostic.id)).toEqual({ lastFailure: null })
    } finally { await runtime.dispose() }
  })
})
