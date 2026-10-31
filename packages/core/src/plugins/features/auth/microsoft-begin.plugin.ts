import { defineFeature } from '@rhine/plugin-api'
import { featureMicrosoftConfiguration, microsoftEndpoints, type MicrosoftBeginInput } from '../../../accounts/config.ts'
import { accountsState } from '../../../accounts/environment.ts'
import { cancelMicrosoftFlows, storeMicrosoftFlow, type BoundDeviceCodeFlow } from '../../../accounts/flows.ts'
import { parseDeviceCode, tokenErrorCode, oauthErrorHint, type DeviceCodeBody, type TokenBody } from '../../../accounts/microsoft.ts'
import { AccountError, throwIfAborted } from '../../../accounts/errors.ts'
import { FORM_HEADERS, formEncode, requestJson, readAccountRequest, requestString } from '../../../accounts/http.ts'

export default defineFeature<MicrosoftBeginInput | undefined, Promise<BoundDeviceCodeFlow>>({
  id: 'auth.microsoft.begin', capability: 'auth.microsoft.begin', title: '开始微软设备码登录', depends: ['settings.get'],
  http: { method: 'POST', path: '/api/accounts/microsoft/start',
    decode: async request => { const body = await readAccountRequest(request); return { clientId: requestString(body, 'clientId', true), authority: requestString(body, 'authority', true) } },
    // The browser needs the user code, not the secret OAuth device code.
    encode: ({ deviceCode: _deviceCode, ...flow }) => flow },
  setup(env) { const state = accountsState(env); env.onDispose(() => cancelMicrosoftFlows(state)) },
  async execute(input, env) {
    env.task?.throwIfCancelled()
    const config = featureMicrosoftConfiguration(env, input)
    const response = await requestJson<DeviceCodeBody & TokenBody>(microsoftEndpoints(config).deviceCode, {
      method: 'POST', headers: FORM_HEADERS, body: formEncode({ client_id: config.clientId, scope: 'XboxLive.signin offline_access' }),
    }, '请求微软登录设备码', env.signal)
    const code = tokenErrorCode(response.body)
    if (response.status < 200 || response.status >= 300 || code) {
      const failure = code ?? 'DEVICE_CODE_FAILED'
      throw new AccountError('无法启动微软登录：' + oauthErrorHint(failure) + '（' + failure + '）', failure)
    }
    const flow = parseDeviceCode(response.body)
    if (!flow) throw new AccountError('微软返回的设备码信息不完整，请重试', 'DEVICE_CODE_INVALID')
    throwIfAborted(env.signal)
    return storeMicrosoftFlow(accountsState(env), flow, config)
  },
})
