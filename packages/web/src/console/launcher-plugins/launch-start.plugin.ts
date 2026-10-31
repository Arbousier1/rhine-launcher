import { defineFeature, FeatureError } from '@rhine/plugin-api'
import type { LauncherSession } from '../launcher-state'
import { action, request } from './internal/request'
import { invalid, session, text } from './internal/validation'

export default defineFeature<{ id: string }, Promise<LauncherSession>>({
  id: 'launcher.launch.start', capability: 'launcher.launch.start', title: '启动实例',
  execute(input, env) {
    const id = text(input?.id, '实例 id')
    return action(env, 'launch', id, async state => {
      state.requireAvailable('instances')
      if (state.sessionFor(id)) throw new FeatureError('ALREADY_RUNNING', '实例已有运行中的会话', 409)
      const account = state.selectedAccount()
      // 202 contains the actual Session, not a task or a synthetic progress record.
      const created = session(await request(env, '/api/launch', { method: 'POST', body: JSON.stringify({ instanceId: id, accountId: account.id, detach: true }) }))
      if (created.instanceId !== id) invalid('启动会话实例 id')
      state.upsertSession(created)
      return created
    })
  },
})
