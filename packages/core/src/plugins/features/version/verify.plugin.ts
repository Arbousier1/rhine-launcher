import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { MetaService } from '../../../services/meta.ts'

/** Single public operation: version.verify. */
export default defineFeature<any,any>({
  id:"version.verify",capability:"version.verify",title:"version.verify",
  depends:["paths.get"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.meta',ctx=>new MetaService(ctx)).isInstalled(readId(input))}
})
