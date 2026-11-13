import {defineFeature} from '@rhine/plugin-api'
import {compatibility,persist} from '../../../ellan/state.ts'
import type {Instance} from '../../../types.ts'
async function cleanup(_input:unknown,env:import('@rhine/plugin-api').FeatureEnvironment){
 const registered=await env.use<Promise<Instance[]>>('instance.list'),ids=new Set(registered.map(i=>i.id)),data=await compatibility(env)
 let changed=false
 for(const id of Object.keys(data.instances))if(!ids.has(id)){delete data.instances[id];changed=true}
 if(changed)await persist(env)
}
export default defineFeature({id:'ellan.instance.compat-cleanup',capability:'ellan.instance.compat-cleanup',title:'清理已删除实例兼容记录',depends:['instance.list','paths.get','storage.read','storage.write','events.subscribe.public'],execute:cleanup,
 async setup(env){await cleanup(undefined,env);const off=env.use<()=>void>('events.subscribe.public',(event:unknown)=>{if(event&&typeof event==='object'&&Reflect.get(event,'type')==='instance-removed')void cleanup(undefined,env).catch(error=>{if(!env.signal.aborted)env.context.logger('ellan-cleanup').warn('%s',String(error))})});env.onDispose(off)}
})
