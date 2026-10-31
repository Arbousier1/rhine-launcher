import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { JavaService } from '../../../services/java.ts'

/** Single public operation: java.pick. */
export default defineFeature<any,any>({
  id:"java.pick",capability:"java.pick",title:"java.pick",
  depends:["paths.get","storage.read.sync"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.java',ctx=>new JavaService(ctx)).pick(integer(input.majorVersion,'Java major',1,99),input.preferred)}
})
