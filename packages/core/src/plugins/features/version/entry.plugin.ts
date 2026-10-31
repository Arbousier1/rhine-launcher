import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { MetaService } from '../../../services/meta.ts'

/** Single public operation: version.entry. */
export default defineFeature<any,any>({
  id:"version.entry",capability:"version.entry",title:"version.entry",
  depends:["paths.get","settings.resolve","storage.read","storage.write","download.text"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.meta',ctx=>new MetaService(ctx)).remoteVersion(readId(input))}
})
