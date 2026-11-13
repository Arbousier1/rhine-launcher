import {watch,type FSWatcher} from 'node:fs'
import {isAbsolute,resolve} from 'node:path'
import type {FeatureEnvironment} from '@rhine/plugin-api'
import {FeatureError} from '@rhine/plugin-api'
import {store,restoreState,emitOriginal,type OriginalStateRecord} from './state.ts'
export const STATE_GETTERS=['ellan.base.settings','ellan.instance.state','ellan.user.state','ellan.java.state','ellan.version.state','ellan.mods.watch','ellan.resourcepacks.watch','ellan.shaders.watch','ellan.options.watch','ellan.saves.watch','ellan.servers.watch','ellan.install.watch','ellan.collection.state','ellan.account.state','ellan.mod-group.state'] as const
export function attachOriginalStateWatch(env:FeatureEnvironment){
 const cache=store(env),watchers=new Map<string,{watcher:FSWatcher;states:Set<string>}>(),timers=new Map<string,ReturnType<typeof setTimeout>>()
 let disposed=false
 const refresh=async(value:OriginalStateRecord)=>{
  if(disposed||!cache.ids.has(value.id)||!value.renderers.size)return
  const owner=value.renderers.values().next().value
  if(!owner)return
  const previous=structuredClone(value.snapshot)
  try{
   emitOriginal(env,'state-validating',[{id:value.id,semaphore:1}])
   await env.use(value.feature,{rendererId:owner,args:value.args})
   if(cache.ids.has(value.id))restoreState(env,value,previous)
  }catch(error){if(!(error instanceof FeatureError)||!['PLUGIN_UNAVAILABLE','PLUGIN_CANCELLED','PLUGIN_NOT_FOUND'].includes(error.code))env.context.logger('ellan-watch').warn('%s',String(error))}
  finally{if(!disposed&&!env.signal.aborted)emitOriginal(env,'state-validating',[{id:value.id,semaphore:0}])}
 }
 const schedule=(value:OriginalStateRecord)=>{
  const prior=timers.get(value.id);if(prior)clearTimeout(prior)
  const timer=setTimeout(()=>{timers.delete(value.id);void refresh(value)},80);timer.unref();timers.set(value.id,timer)
 }
 const applies=(value:OriginalStateRecord,name:string)=>{
  const key=value.key.toLowerCase()
  if(value.type==='ResourceState')return name.startsWith(key.split(':')[0]+'/')||name===key.split(':')[0]
  if(value.type==='GameOptionsState')return ['options.txt','eula.txt'].includes(name)||name.startsWith('config/')
  if(value.type==='Saves')return name==='saves'||name.startsWith('saves/')
  if(value.type==='ServerInfoState')return name==='servers.dat'
  if(value.type==='InstanceModsGroupState')return name.endsWith('-groups.json')
  return false
 }
 const registered=(value:OriginalStateRecord)=>{
  if(!value.renderers.size||typeof value.args[0]!=='string'||!isAbsolute(value.args[0]))return
  if(!['ResourceState','GameOptionsState','Saves','ServerInfoState','InstanceModsGroupState'].includes(value.type))return
  const path=resolve(value.args[0]);let entry=watchers.get(path)
  if(!entry){
   try{
    const watcher=watch(path,{recursive:true,persistent:false},(_event,file)=>{
     if(disposed||!file)return
     const name=String(file).replace(/\\/g,'/')
     for(const id of watchers.get(path)?.states??[]){const key=cache.ids.get(id),state=key?cache.states.get(key):undefined;if(state&&applies(state,name))schedule(state)}
    })
    watcher.on('error',error=>env.context.logger('ellan-watch').warn('%s',String(error)))
    entry={watcher,states:new Set()};watchers.set(path,entry)
   }catch(error){env.context.logger('ellan-watch').warn('无法监听 %s: %s',path,String(error));return}
  }
  entry.states.add(value.id)
 }
 const removed=(value:OriginalStateRecord)=>{
  const timer=timers.get(value.id);if(timer)clearTimeout(timer);timers.delete(value.id)
  for(const [path,entry]of watchers){entry.states.delete(value.id);if(!entry.states.size){entry.watcher.close();watchers.delete(path)}}
 }
 cache.registered.add(registered);cache.removed.add(removed);for(const value of cache.states.values())registered(value)
 const off=env.use<()=>void>('events.subscribe.public',(event:unknown)=>{
  if(!event||typeof event!=='object')return
  const type=Reflect.get(event,'type')
  for(const value of cache.states.values())if(type==='settings'&&value.type==='Settings'||(type==='instance'||type==='instance-removed')&&value.type==='InstanceState'||(type==='account'||type==='account-removed')&&value.type==='UserState')schedule(value)
 })
 return()=>{if(disposed)return;disposed=true;off();cache.registered.delete(registered);cache.removed.delete(removed);for(const timer of timers.values())clearTimeout(timer);timers.clear();for(const {watcher}of watchers.values())watcher.close();watchers.clear()}
}
