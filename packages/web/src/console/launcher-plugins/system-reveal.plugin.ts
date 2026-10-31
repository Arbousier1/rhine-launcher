import { defineFeature } from '@rhine/plugin-api'
import { action, request } from './internal/request'
import { success, text } from './internal/validation'

export default defineFeature<{ path: string }, Promise<void>>({
  id: 'launcher.system.reveal', capability: 'launcher.system.reveal', title: '在系统中打开目录',
  execute(input, env) {
    return action(env, 'reveal', undefined, async () => {
      const path = text(input?.path, '目录路径')
      success(await request(env, '/api/system/reveal', { method: 'POST', body: JSON.stringify({ path }) }))
    })
  },
})
