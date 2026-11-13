import { defineFeature } from '@rhine/plugin-api'
import type { LauncherAction } from '../launcher-state'
import { action, request } from './internal/request'
import { success, text } from './internal/validation'

/** Deleting is its own capability: it removes an instance, never a shared resource root. */
export default defineFeature<{ id: string; deleteFiles?: boolean }, Promise<void>>({
  id: 'launcher.instance.delete', capability: 'launcher.instance.delete', title: '删除启动器实例',
  execute(input, env) {
    const id = text(input?.id, '实例 id')
    const deleteFiles = input?.deleteFiles !== false
    return action(env, 'delete' as LauncherAction, id, async state => {
      success(await request(env, '/api/instances/' + encodeURIComponent(id) + '?deleteFiles=' + String(deleteFiles), { method: 'DELETE' }))
      state.removeInstance(id)
    })
  },
})
