import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RawVersionJson, RhPaths } from '../../../contracts.ts'
import { identifier, object } from '../../http-input.ts'
import { clientJarPath } from '../../../meta/install.ts'
/** Install just the vanilla client artifact. */
export default defineFeature<{version:RawVersionJson},Promise<void>>({
 id:'minecraft.client.install',capability:'minecraft.client.install',title:'安装客户端文件',depends:['paths.get','download.file'],
 async execute(input,env){
  const version=input.version;identifier(version.id)
  const client=version.downloads?.client
  if(!client?.url||!client.sha1)throw new Error('版本缺少可校验的客户端下载信息')
  const paths=env.use<RhPaths>('paths.get')
  await env.use<Promise<number>>('download.file',{url:client.url,sha1:client.sha1,size:client.size,destination:clientJarPath(paths.versions,version.id),skipIfExists:true})
 }
})
