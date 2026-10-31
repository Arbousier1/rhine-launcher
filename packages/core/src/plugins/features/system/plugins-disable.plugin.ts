import { defineFeature,FeatureError } from '@rhine/plugin-api'
import {join} from 'node:path'
import type {RhPaths} from '../../../contracts.ts'
import {readId} from '../../http-input.ts'
export default defineFeature<{id:string},Promise<unknown>>({
 id:'plugins.disable',capability:'plugins.disable',title:'停用单个功能插件',depends:['paths.get','storage.write'],
 http:{method:'POST',path:'/api/plugins/:id/disable',decode:(_request,params)=>({id:params.id})},
 async execute(input,env){
  const id=readId(input)
  if(['plugins.list','plugins.enable','plugins.disable','paths.get','storage.write'].includes(id))throw new FeatureError('PROTECTED_PLUGIN','插件管理需要保留此基础能力；请通过启动配置修改',409)
  await env.context.features.disable(id)
  const root=env.use<RhPaths>('paths.get').root
  await env.use<Promise<void>>('storage.write',{file:join(root,'plugins.json'),value:env.context.features.configuration()})
  return {ok:true,plugins:env.context.features.list()}
 }
})
