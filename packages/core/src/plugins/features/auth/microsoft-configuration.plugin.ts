import { defineFeature } from '@rhine/plugin-api'
import type { Settings } from '../../../types.ts'
import { microsoftConfigurationStatus, type MicrosoftConfigurationStatus } from '../../../accounts/configuration.ts'

/** Read-only metadata, independent of configuration writes and login flows. */
export default defineFeature<undefined, MicrosoftConfigurationStatus>({
  id: 'auth.microsoft.configuration', capability: 'auth.microsoft.configuration', title: '读取微软登录配置',
  depends: ['settings.get'],
  http: { method: 'GET', path: '/api/accounts/microsoft/configuration', decode: () => undefined },
  execute(_input, env) { return microsoftConfigurationStatus(env.use<Settings>('settings.get')) },
})
