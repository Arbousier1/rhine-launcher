import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { MetaService } from '../../../services/meta.ts'

/** Single public operation: version.list. */
export default defineFeature<any,any>({
  id:"version.list",capability:"version.list",title:"version.list",
  depends:["paths.get","settings.get","settings.resolve","storage.read","storage.write","download.text"],
  http:{method:'GET',path:'/api/versions/remote',decode:request=>{const include=query(request).includeSnapshots;return include===undefined?undefined:{includeSnapshots:flag(include,'includeSnapshots')}},status:200},
  async execute(input:any,env:FeatureEnvironment){const versions=await implementation(env,'engine.meta',ctx=>new MetaService(ctx)).remoteVersions();return (input?.includeSnapshots??env.use<import('../../../types.ts').Settings>('settings.get').showSnapshots)?versions:versions.filter(version=>version.type!=='snapshot')}
})
