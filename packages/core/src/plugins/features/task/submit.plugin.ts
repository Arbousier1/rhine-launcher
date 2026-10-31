import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { TaskService } from '../../../services/tasks.ts'

/** Single public operation: task.submit. */
export default defineFeature<any,any>({
  id:"task.submit",capability:"task.submit",title:"task.submit",
  depends:["events.emit"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.tasks',ctx=>new TaskService(ctx)).run(string(input.title),string(input.kind),input.body,env.signal)}
})
