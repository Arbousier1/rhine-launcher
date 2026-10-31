import { defineFeature } from '@rhine/plugin-api'
import { ModService } from '../../../services/mods.ts'
import { instanceId } from './support.ts'
export default defineFeature({
  id: 'mod.list', capability: 'mod.list', title: '列出模组',
  depends: ['paths.get', 'instance.get'],
  http: { method: 'GET', path: '/api/instances/:id/mods', decode: (_request, params) => ({ id: params.id }) },
  execute(input: unknown, env) { return new ModService(env).list(instanceId(input)) },
})
