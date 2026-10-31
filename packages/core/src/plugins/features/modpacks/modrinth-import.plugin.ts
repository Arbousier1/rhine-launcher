import { defineFeature } from '@rhine/plugin-api'
import { importModpack } from '../../../modpack/importer.ts'
export default defineFeature({
  id: 'modpack.modrinth.import', capability: 'modpack.modrinth.import', title: '导入 Modrinth 整合包',
  depends: ['paths.get', 'instance.import.commit', 'version.install'],
  optionalDepends: ['loader.fabric.install', 'loader.quilt.install', 'loader.forge.install', 'loader.neoforge.install'],
  http: { method: 'POST', path: '/api/modpacks/modrinth/import', decode: request => request.json(), background: { kind: 'import-modpack', title: '导入 Modrinth 整合包' } },
  execute(input: unknown, env) { return importModpack(input, env, 'modrinth') },
})
