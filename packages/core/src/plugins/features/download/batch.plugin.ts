import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { DownloadService } from '../../../services/download.ts'

/** Single public operation: download.batch. */
export default defineFeature<any,any>({
  id:"download.batch",capability:"download.batch",title:"download.batch",
  depends:["settings.get","download.file"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.download',ctx=>new DownloadService(ctx)).batch(input.items,taskContext(env,input.handle),input.concurrency)}
})
