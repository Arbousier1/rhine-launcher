import { defineFeature } from '@rhine/plugin-api'
import { ModService } from '../../../services/mods.ts'
import { instanceId, modBody } from './support.ts'
export default defineFeature({
  id: 'mod.import', capability: 'mod.import', title: '导入已下载模组',
  depends: ['paths.get', 'instance.get'],
  http: { method: 'POST', path: '/api/instances/:id/mods/import', decode: modBody },
  execute(input: unknown, env) { return new ModService(env).import(instanceId(input), input) },
})
