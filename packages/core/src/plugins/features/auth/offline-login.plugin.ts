import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { ACCOUNT_WRITE_DEPENDS, accountRepository } from '../../../accounts/environment.ts'
import { OFFLINE_NAME_PATTERN, redactAccount } from '../../../accounts/repository.ts'
import { offlineUuid } from '../../../accounts/uuid.ts'
import { AccountError } from '../../../accounts/errors.ts'
import { readAccountRequest, requestString } from '../../../accounts/http.ts'

export default defineFeature<{ name: string }, Promise<Account>>({
  id: 'auth.offline.login', capability: 'auth.offline.login', title: '离线登录', depends: ACCOUNT_WRITE_DEPENDS,
  http: { method: 'POST', path: '/api/accounts/offline', status: 201, encode: redactAccount,
    decode: async request => {const name=requestString(await readAccountRequest(request),'name')!;if(!OFFLINE_NAME_PATTERN.test(name))throw new AccountError('name只能包含字母、数字和下划线，长度1–16位','INVALID_NAME');return {name}} },
  async execute(input, env) {
    const name = typeof input?.name === 'string' ? input.name.trim() : ''
    if (!name) throw new AccountError('请输入玩家名', 'INVALID_NAME')
    if (!OFFLINE_NAME_PATTERN.test(name)) throw new AccountError('玩家名只能包含字母、数字和下划线，长度 1-16 位', 'INVALID_NAME')
    const repository = accountRepository(env)
    const uuid = offlineUuid(name)
    const id = 'offline-' + uuid
    return repository.get(id) ?? repository.upsert({ id, kind: 'offline', name, uuid })
  },
})
