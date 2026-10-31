import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { MetaService } from '../../../services/meta.ts'

/** Single public operation: version.installed. */
export default defineFeature<any,any>({
  id:"version.installed",capability:"version.installed",title:"version.installed",
  depends:["paths.get"],
  http:{method:'GET',path:'/api/versions/installed',decode:()=>undefined,status:200},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.meta',ctx=>new MetaService(ctx)).installed()}
})
