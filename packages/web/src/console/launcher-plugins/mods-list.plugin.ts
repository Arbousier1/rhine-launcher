import { defineFeature } from '@rhine/plugin-api'
import type { LauncherMod } from '../launcher-state'
import { action, request } from './internal/request'
import { list, mod, text } from './internal/validation'

export default defineFeature<{ id: string }, Promise<LauncherMod[]>>({
  id: 'launcher.mods.list', capability: 'launcher.mods.list', title: '读取实例模组',
  execute(input, env) {
    const id = text(input?.id, '实例 id')
    return action(env, 'mods', id, async state => {
      const mods = list(await request(env, '/api/instances/' + encodeURIComponent(id) + '/mods'), mod, '模组列表')
      state.setMods(id, mods)
      return mods
    })
  },
})
