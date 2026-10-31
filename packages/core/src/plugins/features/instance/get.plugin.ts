import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: instance.get. */
export default defineFeature<any,any>({
  id:"instance.get",capability:"instance.get",title:"instance.get",
  depends:["paths.get"],
  http:{method:'GET',path:'/api/instances/:id',decode:(_request,params)=>({id:params.id}),status:200,notFoundMessage:'实例不存在'},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).get(readId(input))}
})
