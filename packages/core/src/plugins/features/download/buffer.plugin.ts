import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { DownloadService } from '../../../services/download.ts'

/** Single public operation: download.buffer. */
export default defineFeature<any,any>({
  id:"download.buffer",capability:"download.buffer",title:"download.buffer",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.download',ctx=>new DownloadService(ctx)).buffer(string(typeof input==='string'?input:input.url),{...(typeof input==='object'?input.options:{}),signal:env.signal})}
})
