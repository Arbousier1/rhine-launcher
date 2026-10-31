import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { ACCOUNT_WRITE_DEPENDS, accountRepository } from '../../../accounts/environment.ts'
import { refreshYggdrasil, validateAuthServerUrl } from '../../../accounts/authlib-injector.ts'
import { compactUuid, expandUuid } from '../../../accounts/uuid.ts'
import { redactAccount } from '../../../accounts/repository.ts'
import { accountId, requireAccount } from '../../../accounts/inputs.ts'
import { AccountError } from '../../../accounts/errors.ts'

export default defineFeature<{ id: string }, Promise<Account>>({
  id: 'auth.yggdrasil.refresh', capability: 'auth.yggdrasil.refresh', title: '刷新 Yggdrasil 令牌', depends: ['account.get', ...ACCOUNT_WRITE_DEPENDS],
  http: { method: 'POST', path: '/api/accounts/authlib-injector/:id/refresh', decode: (_request, params) => ({ id: params.id! }), encode: redactAccount },
  async execute(input, env) {
    const account = requireAccount(env, accountId(input))
    if (account.kind !== 'authlib-injector') throw new AccountError('此功能仅用于 Yggdrasil 账号', 'WRONG_ACCOUNT_PROVIDER')
    if (!account.authServerUrl || !account.accessToken) throw new AccountError('外置账号缺少认证信息，请重新登录', 'MISSING_CREDENTIALS')
    const fresh = await refreshYggdrasil(validateAuthServerUrl(account.authServerUrl), account.accessToken, account.clientToken,
      { signal: env.signal, selectedProfile: { id: compactUuid(account.uuid), name: account.name } })
    if (fresh.profile && expandUuid(fresh.profile.id) !== expandUuid(account.uuid)) throw new AccountError('外置令牌刷新返回了不同的角色，未覆盖原账号', 'PROFILE_MISMATCH')
    return accountRepository(env).upsert({ ...account, accessToken: fresh.accessToken, clientToken: fresh.clientToken ?? account.clientToken, name: fresh.profile?.name ?? account.name })
  },
})
