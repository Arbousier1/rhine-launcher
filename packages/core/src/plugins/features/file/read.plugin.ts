import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: file.read. */
export default defineFeature<any,any>({
  id:"file.read",capability:"file.read",title:"file.read",
  depends:["paths.get"],
  http:{method:'GET',path:'/api/instances/:id/file',decode:(request,params)=>({id:params.id,path:query(request).path}),status:200,encode:(content,input)=>({path:input.path,content})},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).readFile(readId(input),string(input.path))}
})
