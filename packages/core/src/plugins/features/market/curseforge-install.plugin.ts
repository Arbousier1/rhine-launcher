import { defineFeature } from '@rhine/plugin-api'
import { curseforgeClient } from '../../market-client.ts'
import { json,object,string,query,integer } from '../../http-input.ts'
import { implementation } from '../../implementation.ts'
import { taskContext } from '../../task-context.ts'
import { MarketService } from '../../../services/market.ts'
import type { MarketVersion } from '../../../types.ts'
import { FeatureError } from '@rhine/plugin-api'
export default defineFeature<any,any>({
 id:'market.curseforge.install',capability:'market.curseforge.install',title:'安装 curseforge 内容',depends:['paths.get','instance.get','settings.resolve','download.file','market.curseforge.project','market.curseforge.versions'],
 http:{method:'POST',path:'/api/market/curseforge/install',decode:json,background:{kind:'market-install',title:'安装 curseforge 内容'}},
 async execute(input,env){
  const requested=object(input.version)
  const versions=await env.use<Promise<MarketVersion[]>>('market.curseforge.versions',{projectId:string(requested.projectId)})
  const version=versions.find(item=>item.id===String(requested.id))
  if(!version)throw new FeatureError('VERSION_NOT_FOUND','内容版本不存在或不允许第三方下载',404)
  return implementation(env,'engine.market',ctx=>new MarketService(ctx)).install(string(input.instanceId),version,taskContext(env,input.handle))
 }
})
