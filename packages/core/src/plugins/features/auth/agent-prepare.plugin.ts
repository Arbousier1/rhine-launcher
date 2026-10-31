import { defineFeature, FeatureError } from '@rhine/plugin-api'
import type { Settings } from '../../../types.ts'
import type { RhPaths } from '../../../contracts.ts'
import { ensureAuthlibInjector, validateAuthServerUrl } from '../../../accounts/authlib-injector.ts'
import { readAccountRequest, requestString } from '../../../accounts/http.ts'

export default defineFeature<{ authServerUrl?: string; mirror?: string } | undefined, Promise<string>>({
  id: 'auth.agent.prepare', capability: 'auth.agent.prepare', title: '准备 authlib-injector Java Agent',
  depends: ['paths.get', 'download.text', 'download.buffer'], optionalDepends: ['settings.get'],
  http: { method: 'POST', path: '/api/accounts/authlib-injector/agent', encode: path => ({ path }),
    decode: async request => { const body = await readAccountRequest(request); return { authServerUrl: requestString(body, 'authServerUrl', true), mirror: requestString(body, 'mirror', true) } } },
  execute(input, env) {
    if (input?.authServerUrl) validateAuthServerUrl(input.authServerUrl)
    let mirror = input?.mirror
    if (!mirror) {
      try { mirror = env.use<Settings>('settings.get').authlibInjectorMirror } catch (error) {
        // Configuration is optional: only an absent/disabled settings capability can fall back to the verified default.
        if (!(error instanceof FeatureError) || !['PLUGIN_UNAVAILABLE', 'PLUGIN_NOT_FOUND'].includes(error.code)) throw error
      }
    }
    return ensureAuthlibInjector(env.use<RhPaths>('paths.get').libraries, {
      text: url => env.use<Promise<string>>('download.text', url),
      buffer: url => env.use<Promise<Uint8Array>>('download.buffer', url),
    }, { mirror, signal: env.signal, task: env.task })
  },
})
