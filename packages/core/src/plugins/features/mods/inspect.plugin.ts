import { defineFeature } from '@rhine/plugin-api'
import { ModService } from '../../../services/mods.ts'
export default defineFeature({
  id: 'mod.inspect', capability: 'mod.inspect', title: '检查模组描述',
  depends: ['paths.get', 'instance.get'],
  http: { method: 'POST', path: '/api/mods/inspect', decode: request => request.json() },
  execute(input: unknown, env) { return new ModService(env).inspect(input) },
})
