import type {FeatureEnvironment} from '@rhine/plugin-api'
import type {JavaRuntime} from '../types.ts'
import {toOriginalJava} from '@rhine/ellan-ui/projections'
import {probeOriginalJava} from './launch.ts'
import {type OriginalCall,text} from './feature.ts'
import {emitOriginal,store} from './state.ts'
function cache(env:FeatureEnvironment){return env.state<{records?:JavaRuntime[];pending?:Promise<JavaRuntime[]>}>('ellan.java.probed',()=>({}))}
export async function resolveJava(input:OriginalCall,env:FeatureEnvironment){
 const runtime=await probeOriginalJava(text(input.args[0],'Java path'),env.signal)
 const values=cache(env),records=values.records??=[]
 const index=records.findIndex(j=>j.path===runtime.path);if(index<0)records.push(runtime);else records[index]=runtime
 const record=toOriginalJava(runtime,true),state=store(env).states.get('JavaState')
 if(state){state.snapshot.all=records.map(j=>toOriginalJava(j,true));emitOriginal(env,'commit',[state.id,'javaUpdate',record])}
 return record
}
export async function refreshJava(_input:OriginalCall,env:FeatureEnvironment){
 const values=await env.use<Promise<JavaRuntime[]>>('java.scan'),current=cache(env);current.records=values;current.pending=undefined
 const state=store(env).states.get('JavaState')
 if(state){const previous=Array.isArray(state.snapshot.all)?state.snapshot.all:[],paths=new Set(values.map(j=>j.path));for(const value of previous)if(value&&typeof value==='object'&&!paths.has(Reflect.get(value,'path')))emitOriginal(env,'commit',[state.id,'javaRemove',value]);state.snapshot.all=values.map(j=>toOriginalJava(j,true));emitOriginal(env,'commit',[state.id,'javaUpdate',state.snapshot.all])}
}
