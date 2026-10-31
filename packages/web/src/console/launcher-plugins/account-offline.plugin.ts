import { defineFeature } from '@rhine/plugin-api'
import type { LauncherAccount } from '../launcher-state'
import { action, request } from './internal/request'
import { account, text } from './internal/validation'

export default defineFeature<{ name: string }, Promise<LauncherAccount>>({
  id: 'launcher.account.offline', capability: 'launcher.account.offline', title: '添加离线账号',
  execute(input, env) {
    return action(env, 'account', undefined, async state => {
      const name = text(input?.name, '离线账号名称')
      const created = account(await request(env, '/api/accounts/offline', { method: 'POST', body: JSON.stringify({ name }) }))
      state.upsertAccount(created)
      return created
    })
  },
})
