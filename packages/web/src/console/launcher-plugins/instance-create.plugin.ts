import { defineFeature } from '@rhine/plugin-api'
import type { LauncherInstance, LauncherInstanceConfig } from '../launcher-state'
import { action, request } from './internal/request'
import { instance, object, text } from './internal/validation'

export default defineFeature<LauncherInstanceConfig, Promise<LauncherInstance>>({
  id: 'launcher.instance.create', capability: 'launcher.instance.create', title: '创建启动器实例',
  execute(config, env) {
    return action(env, 'create', undefined, async state => {
      object(config, '实例配置'); text(config.name, '实例名称'); text(config.gameVersion, '游戏版本')
      const created = instance(await request(env, '/api/instances', { method: 'POST', body: JSON.stringify(config) }))
      state.upsertInstance(created)
      return created
    })
  },
})
