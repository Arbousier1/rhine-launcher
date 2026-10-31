import { defineFeature } from '@rhine/plugin-api'
import { validateYggdrasil } from '../../../accounts/authlib-injector.ts'
import { accountId, requireAccount } from '../../../accounts/inputs.ts'
import { AccountError } from '../../../accounts/errors.ts'

export default defineFeature<{ id: string }, Promise<boolean>>({
  id: 'auth.yggdrasil.validate', capability: 'auth.yggdrasil.validate', title: '验证 Yggdrasil 令牌', depends: ['account.get'],
  http: { method: 'POST', path: '/api/accounts/authlib-injector/:id/validate', decode: (_request, params) => ({ id: params.id! }), encode: valid => ({ valid }) },
  async execute(input, env) {
    const account = requireAccount(env, accountId(input))
    if (account.kind !== 'authlib-injector') throw new AccountError('此功能仅用于 Yggdrasil 账号', 'WRONG_ACCOUNT_PROVIDER')
    if (!account.authServerUrl) throw new AccountError('外置账号缺少认证服务器', 'MISSING_CREDENTIALS')
    return validateYggdrasil(account.authServerUrl, account.accessToken ?? '', account.clientToken, env.signal)
  },
})
