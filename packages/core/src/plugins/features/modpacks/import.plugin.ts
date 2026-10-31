import { defineFeature } from '@rhine/plugin-api'
import type { ParsedModpack } from '../../../modpack/importer.ts'
import type { Instance } from '../../../types.ts'
import { check, object } from '../../../modpack/safety.ts'
/** Compatibility workflow; format importers have independent lifecycles. */
export default defineFeature<unknown, Promise<Instance>>({
  id: 'modpack.import', capability: 'modpack.import', title: '导入整合包',
  depends: ['modpack.identify'],
  optionalDepends: ['modpack.modrinth.import', 'modpack.curseforge.import'],
  http: { method: 'POST', path: '/api/instances/import-modpack', decode: request => request.json(), background: { kind: 'import-modpack', title: '导入整合包' } },
  async execute(input, env) {
    const body = object(input)
    check(env)
    const identified = await env.use<Promise<ParsedModpack>>('modpack.identify', body)
    check(env)
    return env.use<Promise<Instance>>('modpack.' + identified.format + '.import', body)
  },
})
