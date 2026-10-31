import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { TaskService } from '../../../services/tasks.ts'

/** Single public operation: task.get. */
export default defineFeature<any,any>({
  id:"task.get",capability:"task.get",title:"task.get",
  depends:[],
  http:{method:'GET',path:'/api/tasks/:id',decode:(_request,params)=>({id:params.id}),status:200},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.tasks',ctx=>new TaskService(ctx)).get(readId(input))}
})
