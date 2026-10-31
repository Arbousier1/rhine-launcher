import { defineFeature } from '@rhine/plugin-api'
import { ACCOUNT_WRITE_DEPENDS, accountRepository } from '../../../accounts/environment.ts'
import { accountId } from '../../../accounts/inputs.ts'

export default defineFeature<{ id: string }, Promise<void>>({
  id: 'account.remove', capability: 'account.remove', title: '删除账号', depends: ACCOUNT_WRITE_DEPENDS,
  http: { method: 'DELETE', path: '/api/accounts/:id', decode: (_request, params) => ({ id: params.id! }), encode: () => ({ ok: true }) },
  execute(input, env) { return accountRepository(env).remove(accountId(input)) },
})
