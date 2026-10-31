import { defineFeature,FeatureError } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { TaskService } from '../../../services/tasks.ts'

/** Single public operation: task.cancel. */
export default defineFeature<any,any>({
  id:"task.cancel",capability:"task.cancel",title:"task.cancel",
  depends:["events.emit"],
  http:{method:'POST',path:'/api/tasks/:id/cancel',decode:(_request,params)=>({id:params.id}),status:200,encode:result=>({ok:result})},
  execute(input:any,env:FeatureEnvironment){const ok=implementation(env,'engine.tasks',ctx=>new TaskService(ctx)).cancel(readId(input));if(!ok)throw new FeatureError('NOT_FOUND','任务不存在或已经结束',404);return ok}
})
