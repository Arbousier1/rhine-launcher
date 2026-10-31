import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { PathsService } from '../../../services/paths.ts'

/** Single public operation: paths.ensure. */
export default defineFeature<any,any>({
  id:"paths.ensure",capability:"paths.ensure",title:"paths.ensure",
  depends:["paths.get"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.paths',ctx=>new PathsService(ctx,env.state('core.options',()=>({})))).ensure()}
})
