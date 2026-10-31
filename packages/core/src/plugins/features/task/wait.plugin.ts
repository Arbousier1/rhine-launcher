import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { TaskService } from '../../../services/tasks.ts'

/** Single public operation: task.wait. */
export default defineFeature<any,any>({
  id:"task.wait",capability:"task.wait",title:"task.wait",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.tasks',ctx=>new TaskService(ctx)).wait(readId(input))}
})
