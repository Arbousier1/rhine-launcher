import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: instance.add-playtime. */
export default defineFeature<any,any>({
  id:"instance.add-playtime",capability:"instance.add-playtime",title:"instance.add-playtime",
  depends:["paths.get","storage.write"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).addPlayTime(readId(input),input.elapsedMs)}
})
