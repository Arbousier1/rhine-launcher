import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { ACCOUNT_WRITE_DEPENDS, accountRepository } from '../../../accounts/environment.ts'
import { accountId, requireAccount } from '../../../accounts/inputs.ts'
import { normalizeMicrosoftAuthority, microsoftEndpoints } from '../../../accounts/config.ts'
import { exchangeMicrosoftForMinecraft } from '../../../accounts/microsoft-chain.ts'
import { MICROSOFT_SCOPE, parseTokenBody, tokenErrorCode, oauthErrorHint, type TokenBody } from '../../../accounts/microsoft.ts'
import { AccountError } from '../../../accounts/errors.ts'
import { FORM_HEADERS, formEncode, requestJson } from '../../../accounts/http.ts'
import { redactAccount } from '../../../accounts/repository.ts'

export default defineFeature<{ id: string }, Promise<Account>>({
  id: 'auth.microsoft.refresh', capability: 'auth.microsoft.refresh', title: '刷新微软令牌', depends: ['account.get', ...ACCOUNT_WRITE_DEPENDS],
  http: { method: 'POST', path: '/api/accounts/microsoft/:id/refresh', decode: (_request, params) => ({ id: params.id! }), encode: redactAccount },
  async execute(input, env) {
    const account = requireAccount(env, accountId(input))
    if (account.kind !== 'microsoft') throw new AccountError('此功能仅用于微软账号', 'WRONG_ACCOUNT_PROVIDER')
    if (!account.refreshToken) throw new AccountError('该账号缺少刷新令牌，请重新登录微软账号', 'MISSING_REFRESH_TOKEN')
    if (!account.microsoftClientId || !account.microsoftAuthority) {
      throw new AccountError('旧账号没有保存原 OAuth 应用身份，无法安全刷新。请用你配置的应用重新登录；不会猜测或替换 client_id。', 'MISSING_OAUTH_IDENTITY')
    }
    const config = { clientId: account.microsoftClientId, authority: normalizeMicrosoftAuthority(account.microsoftAuthority) }
    const response = await requestJson<TokenBody>(microsoftEndpoints(config).token, {
      method: 'POST', headers: FORM_HEADERS,
      body: formEncode({ grant_type: 'refresh_token', client_id: config.clientId, refresh_token: account.refreshToken, scope: MICROSOFT_SCOPE }),
    }, '刷新微软访问令牌', env.signal)
    const code = tokenErrorCode(response.body)
    if (response.status < 200 || response.status >= 300 || code) {
      const failure = code ?? 'REFRESH_FAILED'
      throw new AccountError(oauthErrorHint(failure) + '（' + failure + '）', failure)
    }
    const tokens = parseTokenBody(response.body)
    if (!tokens) throw new AccountError('微软没有返回新的访问令牌，请重试', 'INVALID_TOKEN_RESPONSE')
    env.task?.throwIfCancelled()
    const fresh = await exchangeMicrosoftForMinecraft(tokens, config, env.signal, account)
    return accountRepository(env).upsert(fresh)
  },
})
