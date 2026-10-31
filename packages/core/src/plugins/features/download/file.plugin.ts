import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import { implementation } from '../../implementation.ts'
import { json, object, string, identifier, readId, query, flag, integer } from '../../http-input.ts'
import { taskContext } from '../../task-context.ts'
import { DownloadService } from '../../../services/download.ts'

/** Single public operation: download.file. */
export default defineFeature<any,any>({
  id:"download.file",capability:"download.file",title:"download.file",
  depends:["settings.get"],
  execute(input:any,env:FeatureEnvironment){return implementation(env,'engine.download',ctx=>new DownloadService(ctx)).file(({...object(input),url:string(input.url,'下载 URL'),destination:string(input.destination,'下载路径'),signal:input.signal?AbortSignal.any([env.signal,input.signal]):env.signal}))}
})
