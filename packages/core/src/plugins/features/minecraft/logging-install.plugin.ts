import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RawVersionJson, RhPaths } from '../../../contracts.ts'
import { identifier, object } from '../../http-input.ts'
import { join } from 'node:path'
/** Install only the launcher logging configuration. */
export default defineFeature<{version:RawVersionJson},Promise<void>>({
 id:'minecraft.logging.install',capability:'minecraft.logging.install',title:'安装日志配置',depends:['paths.get','download.file'],
 async execute(input,env){
  const config=input.version.logging?.client?.file
  if(!config)return
  identifier(config.id,'日志配置文件名')
  const paths=env.use<RhPaths>('paths.get')
  await env.use<Promise<number>>('download.file',{url:config.url,sha1:config.sha1,size:config.size,destination:join(paths.assets,'log_configs',config.id),skipIfExists:true})
 }
})
