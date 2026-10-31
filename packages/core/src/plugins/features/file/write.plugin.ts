import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: file.write. */
export default defineFeature<any,any>({
  id:"file.write",capability:"file.write",title:"file.write",
  depends:["paths.get"],
  http:{method:'PUT',path:'/api/instances/:id/file',decode:async(request,params)=>{const body=await json(request);return {...body,id:identifier(params.id),path:string(body.path,'path'),content:typeof body.content==='string'?body.content:''}},status:200,encode:()=>({ok:true})},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).writeFile(readId(input),string(input.path),input.content,env.signal)}
})
