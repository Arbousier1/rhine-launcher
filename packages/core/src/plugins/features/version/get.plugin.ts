import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { MetaService } from '../../../services/meta.ts'

/** Single public operation: version.get. */
export default defineFeature<any,any>({
  id:"version.get",capability:"version.get",title:"version.get",
  depends:["paths.get","settings.resolve","storage.read","storage.write","download.text"],
  http:{method:'GET',path:'/api/versions/:id/json',decode:(_request,params)=>({id:params.id}),status:200},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.meta',ctx=>new MetaService(ctx)).versionJson(readId(input))}
})
