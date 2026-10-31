import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { accountId, requireAccount } from '../../../accounts/inputs.ts'
import { redactAccount } from '../../../accounts/repository.ts'

/** One workflow action dispatches to declared provider-specific refresh capabilities. */
export default defineFeature<{ id: string }, Promise<Account>>({
  id: 'account.refresh', capability: 'account.refresh', title: '刷新账号', depends: ['account.get'],
  optionalDepends: ['auth.microsoft.refresh', 'auth.yggdrasil.refresh'],
  http: { method: 'POST', path: '/api/accounts/:id/refresh', decode: (_request, params) => ({ id: params.id! }), encode: redactAccount },
  async execute(input, env) {
    const account = requireAccount(env, accountId(input))
    if (account.kind === 'offline') return account
    return env.use<Promise<Account>>(account.kind === 'microsoft' ? 'auth.microsoft.refresh' : 'auth.yggdrasil.refresh', { id: account.id })
  },
})
