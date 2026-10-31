import { defineFeature } from '@rhine/plugin-api'
import { ModService } from '../../../services/mods.ts'
import { object } from '../../../modpack/safety.ts'
import { instanceId } from './support.ts'
export default defineFeature({
  id: 'mod.remove', capability: 'mod.remove', title: '删除模组',
  depends: ['paths.get', 'instance.get'],
  http: { method: 'DELETE', path: '/api/instances/:id/mods/:diskName', decode: (_request, params) => params, encode: () => ({ ok: true }) },
  execute(input: unknown, env) { const body = object(input); return new ModService(env).remove(instanceId(body), body.diskName) },
})
