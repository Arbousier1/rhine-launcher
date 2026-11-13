import { defineFeature } from '@rhine/plugin-api'
import { configureMicrosoft, type MicrosoftConfigurationStatus } from '../../../accounts/configuration.ts'
import { readAccountRequest } from '../../../accounts/http.ts'

/** One configuration write; it does not require or start a Microsoft login flow. */
export default defineFeature<unknown, Promise<MicrosoftConfigurationStatus>>({
  id: 'auth.microsoft.configure', capability: 'auth.microsoft.configure', title: '保存微软登录配置',
  depends: ['settings.get', 'settings.update'],
  http: { method: 'PUT', path: '/api/accounts/microsoft/configuration', decode: readAccountRequest },
  execute(input, env) { return configureMicrosoft(input, env) },
})
