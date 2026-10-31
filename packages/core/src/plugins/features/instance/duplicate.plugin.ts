import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: instance.duplicate. */
export default defineFeature<any,any>({
  id:"instance.duplicate",capability:"instance.duplicate",title:"instance.duplicate",
  depends:["paths.get","storage.write","events.emit"],
  http:{method:'POST',path:'/api/instances/:id/duplicate',decode:async(request,params)=>({...await json(request),id:params.id}),status:201},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).duplicate(readId(input),string(input.name,'档案名'))}
})
