import { defineFeature } from '@rhine/plugin-api'
import { ModService } from '../../../services/mods.ts'
import { object } from '../../../modpack/safety.ts'
import { instanceId, modBody } from './support.ts'
export default defineFeature({
  id: 'mod.install', capability: 'mod.install', title: '下载并安装模组',
  depends: ['paths.get', 'instance.get'],
  http: { method: 'POST', path: '/api/instances/:id/mods', decode: modBody, background: { kind: 'mod-install', title: '安装模组' } },
  execute(input: unknown, env) { const body = object(input); return new ModService(env).install(instanceId(body), body.url, body.fileName, { hashes: body.hashes, size: body.size }) },
})
