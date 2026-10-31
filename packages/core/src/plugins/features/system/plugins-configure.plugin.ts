import {defineFeature,FeatureError} from '@rhine/plugin-api'
import {json} from '../../http-input.ts'
import type {RhPaths} from '../../../contracts.ts'
import {join} from 'node:path'
export default defineFeature<any,Promise<unknown>>({
 id:'plugins.configure',capability:'plugins.configure',title:'协调插件实例配置',depends:['paths.get','storage.write'],
 http:{method:'POST',path:'/api/plugins/configuration',decode:json},
 async execute(input,env){
  if(!Array.isArray(input.entries))throw new FeatureError('VALIDATION_ERROR','需要插件配置条目数组',400)
  const protectedIds=['plugins.list','plugins.enable','plugins.disable','plugins.configure','paths.get','storage.write']
  if(input.entries.some((entry:any)=>protectedIds.includes(entry?.id)))throw new FeatureError('PROTECTED_PLUGIN','基础管理组件请通过启动配置修改',409)
  await env.context.features.reconcile(input.entries)
  const root=env.use<RhPaths>('paths.get').root
  await env.use<Promise<void>>('storage.write',{file:join(root,'plugins.json'),value:env.context.features.configuration()})
  return {ok:true,plugins:env.context.features.list()}
 }
})
