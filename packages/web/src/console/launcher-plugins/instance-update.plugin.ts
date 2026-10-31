import { defineFeature } from '@rhine/plugin-api'
import type { LauncherInstance, LauncherInstancePatch } from '../launcher-state'
import { action, request } from './internal/request'
import { instance, invalid, object, text } from './internal/validation'

export default defineFeature<{ id: string; patch: LauncherInstancePatch }, Promise<LauncherInstance>>({
  id: 'launcher.instance.update', capability: 'launcher.instance.update', title: '更新启动器实例',
  execute(input, env) {
    const id = text(input?.id, '实例 id')
    return action(env, 'update', id, async state => {
      object(input.patch, '实例配置补丁')
      const updated = instance(await request(env, '/api/instances/' + encodeURIComponent(id), { method: 'PATCH', body: JSON.stringify(input.patch) }))
      if (updated.id !== id) invalid('实例更新 id')
      state.upsertInstance(updated)
      return updated
    })
  },
})
