import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { ACCOUNT_READ_DEPENDS, accountRepository } from '../../../accounts/environment.ts'
import { redactAccount } from '../../../accounts/repository.ts'

export default defineFeature<void, Account[]>({
  id: 'account.list', capability: 'account.list', title: '账号列表', depends: ACCOUNT_READ_DEPENDS,
  http: { method: 'GET', path: '/api/accounts', encode: accounts => accounts.map(redactAccount) },
  execute(_input, env) { return accountRepository(env).list() },
})
