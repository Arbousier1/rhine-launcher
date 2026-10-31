import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { DiagnosticsService } from '../../../services/launch.ts'

/** Single public operation: diagnostics.analyze. */
export default defineFeature<any,any>({
  id:"diagnostics.analyze",capability:"diagnostics.analyze",title:"diagnostics.analyze",
  depends:["paths.get","instance.get"],
  http:{method:'GET',path:'/api/instances/:id/diagnostics',decode:(_request,params)=>({id:params.id}),status:200},
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.launch.diagnostics',ctx=>new DiagnosticsService(ctx)).analyze(readId(input))}
})
