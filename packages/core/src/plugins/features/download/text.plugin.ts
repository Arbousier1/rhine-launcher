import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { DownloadService } from '../../../services/download.ts'

/** Single public operation: download.text. */
export default defineFeature<any,any>({
  id:"download.text",capability:"download.text",title:"download.text",
  depends:[],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.download',ctx=>new DownloadService(ctx)).text(string(typeof input==='string'?input:input.url),{...(typeof input==='object'?input.options:{}),signal:env.signal})}
})
