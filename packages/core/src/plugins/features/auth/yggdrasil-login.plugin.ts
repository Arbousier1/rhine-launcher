import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { ACCOUNT_WRITE_DEPENDS, accountRepository } from '../../../accounts/environment.ts'
import { authenticateYggdrasil, validateAuthServerUrl, yggdrasilAccountId } from '../../../accounts/authlib-injector.ts'
import { expandUuid } from '../../../accounts/uuid.ts'
import { redactAccount } from '../../../accounts/repository.ts'
import { readAccountRequest, requestString } from '../../../accounts/http.ts'

export default defineFeature<{ authServerUrl: string; username: string; password: string; profileId?: string }, Promise<Account>>({
  id: 'auth.yggdrasil.login', capability: 'auth.yggdrasil.login', title: 'Yggdrasil 外置登录', depends: ACCOUNT_WRITE_DEPENDS,
  http: { method: 'POST', path: '/api/accounts/authlib-injector', status: 201, encode: redactAccount,
    decode: async request => { const body = await readAccountRequest(request); return { authServerUrl: requestString(body, 'authServerUrl')!, username: requestString(body, 'username')!, password: requestString(body, 'password')!, profileId: requestString(body, 'profileId', true) } } },
  async execute(input, env) {
    const authServerUrl = validateAuthServerUrl(input?.authServerUrl)
    const fresh = await authenticateYggdrasil(authServerUrl, input.username, input.password, { profileId: input.profileId, signal: env.signal })
    return accountRepository(env).upsert({ id: yggdrasilAccountId(authServerUrl, fresh.profile.id), kind: 'authlib-injector', name: fresh.profile.name,
      uuid: expandUuid(fresh.profile.id)!, authServerUrl, accessToken: fresh.accessToken, clientToken: fresh.clientToken })
  },
})
