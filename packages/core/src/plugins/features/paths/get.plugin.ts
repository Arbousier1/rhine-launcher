import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { PathsService } from '../../../services/paths.ts'

/** Single public operation: paths.get. */
export default defineFeature<any,any>({
  id:"paths.get",capability:"paths.get",title:"paths.get",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.paths',ctx=>new PathsService(ctx,env.state('core.options',()=>({})))).get()}
})
