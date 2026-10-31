import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: instance.remove. */
export default defineFeature<any,any>({
  id:"instance.remove",capability:"instance.remove",title:"instance.remove",
  depends:["paths.get","events.emit"],
  http:{method:'DELETE',path:'/api/instances/:id',decode:(request,params)=>({id:params.id,options:{deleteFiles:flag(query(request).deleteFiles,'deleteFiles',true)}}),status:200,encode:(_output,input)=>({ok:true,id:input.id})},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).remove(readId(input),input.options)}
})
