import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: file.list. */
export default defineFeature<any,any>({
  id:"file.list",capability:"file.list",title:"file.list",
  depends:["paths.get"],
  http:{method:'GET',path:'/api/instances/:id/files',decode:(request,params)=>({id:params.id,subdir:query(request).subdir}),status:200},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).files(readId(input),input.subdir??'')}
})
