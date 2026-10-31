import { defineFeature } from '@rhine/plugin-api'
import { ModService } from '../../../services/mods.ts'
import { object } from '../../../modpack/safety.ts'
import { instanceId, modBody } from './support.ts'
export default defineFeature({
  id: 'mod.toggle', capability: 'mod.toggle', title: '切换模组状态',
  depends: ['paths.get', 'instance.get'],
  http: { method: 'POST', path: '/api/instances/:id/mods/:diskName/toggle', decode: (request, params) => modBody(request, params, true) },
  execute(input: unknown, env) { const body = object(input); return new ModService(env).setEnabled(instanceId(body), body.diskName, body.enabled) },
})
