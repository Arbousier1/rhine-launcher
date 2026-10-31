import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { accountId, requireAccount } from '../../../accounts/inputs.ts'
import { redactAccount } from '../../../accounts/repository.ts'
import { needsRefresh } from '../../../accounts/microsoft.ts'

export default defineFeature<{ id: string }, Promise<Account>>({
  id: 'account.authorize', capability: 'account.authorize', title: '授权账号用于启动', depends: ['account.get'],
  optionalDepends: ['auth.microsoft.refresh', 'auth.yggdrasil.refresh', 'auth.yggdrasil.validate'],
  http: { method: 'POST', path: '/api/accounts/:id/authorize', decode: (_request, params) => ({ id: params.id! }), encode: redactAccount },
  async execute(input, env) {
    const account = requireAccount(env, accountId(input))
    if (account.kind === 'offline') return account
    if (account.kind === 'microsoft') {
      if (!account.accessToken || needsRefresh(account)) return env.use<Promise<Account>>('auth.microsoft.refresh', { id: account.id })
      return account
    }
    if (account.accessToken && await env.use<Promise<boolean>>('auth.yggdrasil.validate', { id: account.id })) return account
    return env.use<Promise<Account>>('auth.yggdrasil.refresh', { id: account.id })
  },
})
