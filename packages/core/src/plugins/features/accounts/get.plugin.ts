import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { ACCOUNT_READ_DEPENDS, accountRepository } from '../../../accounts/environment.ts'
import { redactAccount } from '../../../accounts/repository.ts'
import { accountId } from '../../../accounts/inputs.ts'
import { AccountError } from '../../../accounts/errors.ts'

export default defineFeature<{ id: string }, Account | undefined>({
  id: 'account.get', capability: 'account.get', title: '读取账号', depends: ACCOUNT_READ_DEPENDS,
  http: { method: 'GET', path: '/api/accounts/:id', decode: (_request, params) => ({ id: params.id! }),
    encode: account => { if (!account) throw new AccountError('账号不存在', 'ACCOUNT_NOT_FOUND'); return redactAccount(account) } },
  execute(input, env) { return accountRepository(env).get(accountId(input)) },
})
