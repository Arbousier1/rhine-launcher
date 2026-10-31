import { defineFeature } from '@rhine/plugin-api'
import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RawVersionJson, RhPaths } from '../../../contracts.ts'
import { identifier, object } from '../../http-input.ts'
import { versionJsonPath } from '../../../meta/install.ts'
/** Vanilla install is a single workflow composed from independent file/resource actions. */
export default defineFeature<{gameVersion:string},Promise<void>>({
 id:'version.install',capability:'version.install',title:'安装原版 Minecraft',
 depends:['paths.get','version.get','storage.write','minecraft.client.install','minecraft.libraries.install','minecraft.assets.install','minecraft.logging.install','version.verify'],
 http:{method:'POST',path:'/api/versions/install',background:{kind:'version-install',title:input=>'安装 Minecraft '+input.gameVersion},decode:async request=>({gameVersion:identifier((await request.json()).gameVersion,'gameVersion')})},
 async execute(input,env){
  const id=identifier(input.gameVersion,'游戏版本')
  env.task?.throwIfCancelled()
  env.task?.setProgress({stage:'resolve',value:0,message:'解析 '+id})
  const version=await env.use<Promise<RawVersionJson>>('version.get',{id})
  const paths=env.use<RhPaths>('paths.get')
  await env.use<Promise<void>>('storage.write',{file:versionJsonPath(paths.versions,id),value:version})
  for(const feature of ['minecraft.client.install','minecraft.libraries.install','minecraft.assets.install','minecraft.logging.install']){
   env.task?.throwIfCancelled();env.signal.throwIfAborted()
   await env.use<Promise<void>>(feature,{version})
  }
  if(!await env.use<Promise<boolean>>('version.verify',{id}))throw new Error('客户端校验失败，版本未安装完成')
  env.task?.setProgress({stage:'done',value:1,message:id+' 安装完成'})
 }
})
