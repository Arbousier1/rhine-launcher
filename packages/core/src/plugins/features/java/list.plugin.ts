import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { JavaService } from '../../../services/java.ts'

/** Single public operation: java.list. */
export default defineFeature<any,any>({
  id:"java.list",capability:"java.list",title:"java.list",
  depends:["paths.get","storage.read.sync"],
  http:{method:'GET',path:'/api/java',decode:()=>undefined,status:200},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.java',ctx=>new JavaService(ctx)).cached()}
})
