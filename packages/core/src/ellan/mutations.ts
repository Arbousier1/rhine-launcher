import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import type { Instance, Settings } from '../types.ts'
import {toOriginalInstance} from '@rhine/ellan-ui/projections'
import { type OriginalCall, record, text } from './feature.ts'
import { compatibility, emitOriginal, findState, persist, store } from './state.ts'
import { findInstance, instancesState, settingsState } from './reads.ts'
export const SETTING_METHODS: Record<string,string> = {
 localeSet:'locale', themeSet:'theme', developerModeSet:'developerMode', quickActionShortcutSet:'quickActionShortcut',
 httpProxySet:'httpProxy', httpProxyEnabledSet:'httpProxyEnabled', maxSocketsSet:'maxSockets', maxAPISocketsSet:'maxAPISockets',
 apiSetsPreferenceSet:'apiSetsPreference', disableTelemetrySet:'disableTelemetry', replaceNativesSet:'replaceNatives',
 globalResolutionSet:'globalResolution', globalInstanceSetting:'globalInstanceSetting', windowTranslucentSet:'windowTranslucent',
 linuxTitlebarSet:'linuxTitlebar', allowPrereleaseSet:'allowPrerelease', autoDownloadSet:'autoDownload',
 discordPresenceSet:'discordPresence', multiplayerTransportSet:'multiplayerTransport',
}
export async function settingMutation(method: string, input: OriginalCall, env: FeatureEnvironment) {
 const field = SETTING_METHODS[method]
 if(!field)throw new FeatureError('MUTATION_UNAVAILABLE','Unknown original settings mutation',503)
 const saved=await compatibility(env), value=input.args[0]
 const current=await env.use<Promise<Settings>>('settings.get')
 if(method==='localeSet') {
  if(value!=='zh-CN'&&value!=='en')throw new FeatureError('LOCALE_UNAVAILABLE','Locale is unavailable in this host',400)
  await env.use('settings.update',{language:value==='en'?'en-US':'zh-CN'})
 }
 if(method==='maxSocketsSet') {
  if(typeof value!=='number'||!Number.isInteger(value)||value<1||value>64)throw new FeatureError('INVALID_SETTINGS','Download concurrency is invalid',400)
  await env.use('settings.update',{concurrency:value})
 }
 if(method==='httpProxySet') {
  if(typeof value!=='string')throw new FeatureError('INVALID_SETTINGS','Proxy must be a URL',400)
  const url=value?new URL(value):undefined
  if(url&&!['http:','https:'].includes(url.protocol))throw new FeatureError('INVALID_SETTINGS','Proxy scheme is invalid',400)
  await env.use('settings.update',{proxy:{enabled:current.proxy?.enabled??false,host:url?.hostname??'',port:Number(url?.port||8080)}})
 }
 if(method==='httpProxyEnabledSet')await env.use('settings.update',{proxy:{...current.proxy,host:current.proxy?.host??'',port:current.proxy?.port??8080,enabled:Boolean(value)}})
 saved.settings[field]=value
 await persist(env)
 await settingsState({rendererId:input.rendererId,args:[]},env)
 const state=store(env).states.get('Settings')
 if(state)emitOriginal(env,'commit',[state.id,method,value])
}
export async function commit(input: OriginalCall, env: FeatureEnvironment) {
 const state=findState(env,input.args[0]), method=text(input.args[1],'mutation')
 if(state.type!=='Settings'||!SETTING_METHODS[method])throw new FeatureError('MUTATION_UNAVAILABLE','Original state mutation is unavailable: '+method,503)
 const id='ellan.settings.'+method.replace(/[A-Z]/g,c=>'-'+c.toLowerCase())
 await env.use(id,{rendererId:input.rendererId,args:input.args.slice(2)})
}
export async function editInstance(input: OriginalCall, env: FeatureEnvironment) {
 const options=record(input.args[0]), instance=await findInstance(env,options.instancePath)
 for(const field of ['minMemory','maxMemory']){const value=options[field];if(value!==undefined&&(typeof value!=='number'||!Number.isInteger(value)||value<0||value>1048576))throw new FeatureError('INVALID_ORIGINAL_MEMORY','内存必须是有效的非负整数 MB',400)}
 const patch:Record<string,unknown>={}
 if(typeof options.name==='string')patch.name=options.name
 if(typeof options.java==='string')patch.javaPath=options.java
 if(typeof options.maxMemory==='number'||typeof options.minMemory==='number')patch.memory={...instance.memory,...(typeof options.minMemory==='number'?{minMb:options.minMemory}:{}),...(typeof options.maxMemory==='number'?{maxMb:options.maxMemory}:{})}
 if(Array.isArray(options.vmOptions))patch.jvmArgs=options.vmOptions
 if(Array.isArray(options.mcOptions))patch.gameArgs=options.mcOptions
 if(options.resolution)patch.window=options.resolution
 if(options.runtime) {
  const runtime:Record<string,unknown>={...toOriginalInstance(instance).runtime,...record(options.runtime)}
  if(typeof runtime.minecraft==='string')patch.gameVersion=runtime.minecraft
  const mapping=[['forge','forge'],['fabricLoader','fabric'],['quiltLoader','quilt'],['neoForged','neoforge'],['optifine','optifine']]
  patch.loaders=mapping.filter(([key])=>typeof runtime[key]==='string'&&runtime[key]).map(([key,kind])=>({kind,version:runtime[key]}))
 }
 if(Object.keys(patch).length)await env.use('instance.update',{id:instance.id,patch})
 const saved=await compatibility(env), extra={...options};delete extra.instancePath
 saved.instances[instance.id]={...(saved.instances[instance.id]??{}),...extra}
 await persist(env)
 await instancesState({rendererId:input.rendererId,args:[]},env)
 const state=store(env).states.get('InstanceState')
 if(state)emitOriginal(env,'commit',[state.id,'instanceEdit',{path:instance.path,...extra}])
}
export async function createInstance(input: OriginalCall, env: FeatureEnvironment) {
 const options=record(input.args[0]),runtime=record(options.runtime??{})
 if(typeof runtime.minecraft!=='string'||!runtime.minecraft)throw new FeatureError('EMPTY_RUNTIME_UNSUPPORTED','创建实例必须选择实际 Minecraft 版本',400)
 const created=await env.use<Promise<Instance>>('instance.create',{name:text(options.name,'instance name'),gameVersion:runtime.minecraft})
 try { await editInstance({rendererId:input.rendererId,args:[{...options,instancePath:created.path}]},env) }
 catch(error){await env.use('instance.remove',{id:created.id,deleteFiles:true});const saved=await compatibility(env);delete saved.instances[created.id];await persist(env);throw error}
 return created.path
}
export async function deleteInstance(input: OriginalCall, env: FeatureEnvironment) {
 const instance=await findInstance(env,input.args[0])
 if(input.args[1]!==undefined&&typeof input.args[1]!=='boolean')throw new FeatureError('INVALID_ORIGINAL_CALL','deleteFiles must be a boolean',400)
 await env.use('instance.remove',{id:instance.id,deleteFiles:input.args[1]===true})
 const saved=await compatibility(env);delete saved.instances[instance.id];await persist(env)
 const state=store(env).states.get('InstanceState')
 if(state)emitOriginal(env,'commit',[state.id,'instanceRemove',instance.path])
}
export async function duplicateInstance(input: OriginalCall, env: FeatureEnvironment) {
 const source=await findInstance(env,input.args[0])
 const copied=await env.use<Promise<Instance>>('instance.duplicate',{id:source.id,name:source.name+' Copy'})
 const saved=await compatibility(env);if(saved.instances[source.id]){saved.instances[copied.id]=structuredClone(saved.instances[source.id]);saved.instances[copied.id].name=copied.name;await persist(env)}
 await instancesState({rendererId:input.rendererId,args:[]},env)
 const state=store(env).states.get('InstanceState')
 if(state)emitOriginal(env,'commit',[state.id,'instanceRestore',state.snapshot.instances])
 return copied.path
}
