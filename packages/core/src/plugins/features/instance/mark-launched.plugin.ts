import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { InstanceService } from '../../../services/instances.ts'

/** Single public operation: instance.mark-launched. */
export default defineFeature<any,any>({
  id:"instance.mark-launched",capability:"instance.mark-launched",title:"instance.mark-launched",
  depends:["paths.get","storage.write","events.emit"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).markLaunched(readId(input))}
})
