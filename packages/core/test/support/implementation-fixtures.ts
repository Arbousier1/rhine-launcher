/**
 * Test-only adapters for legacy implementation-level regression tests.
 * Production NEVER imports this module; native feature lifecycle is tested
 * separately through FeatureRuntime and createLauncherContext.
 */
import type {Context} from '@deepseek-ai/cordis'
import type {FeatureEnvironment} from '@rhine/plugin-api'
import {PathsService} from '../../src/services/paths.ts'
import {StorageService} from '../../src/services/storage.ts'
import {SettingsService} from '../../src/services/settings.ts'
import {BusService} from '../../src/services/bus.ts'
import {TaskService} from '../../src/services/tasks.ts'
import {DownloadService} from '../../src/services/download.ts'
import {InstanceService} from '../../src/services/instances.ts'
import {ModService} from '../../src/services/mods.ts'
import {MarketService} from '../../src/services/market.ts'
import {LaunchService,DiagnosticsService} from '../../src/services/launch.ts'
export async function installCore(ctx:Context,options:{root?:string}={}):Promise<Context>{
 ctx.provide('paths',new PathsService(ctx,options))
 ctx.provide('storage',new StorageService(ctx))
 ctx.provide('settings',new SettingsService(ctx))
 ctx.provide('bus',new BusService(ctx))
 ctx.provide('tasks',new TaskService(ctx))
 ctx.provide('download',new DownloadService(ctx))
 return ctx
}
export function instancesPlugin(ctx:Context){ctx.provide('instances',new InstanceService(ctx))}
export function modsPlugin(ctx:Context){
 const states=new Map<string,any>(),controller=new AbortController()
 ctx.effect(()=>()=>controller.abort())
 const env:FeatureEnvironment={
  context:ctx,signal:controller.signal,
  state<T>(key:string,init:()=>T):T{if(!states.has(key))states.set(key,init());return states.get(key)},
  onDispose(cleanup){ctx.effect(()=>cleanup)},
  use<T>(id:string,input:any):T{
   if(id==='paths.get')return ctx.paths.get() as T
   if(id==='instance.get')return ctx.instances.get(input.id) as T
   if(id==='download.file')return ctx.download.file(input) as T
   if(id==='download.text')return ctx.download.text(input) as T
   if(id==='download.buffer')return ctx.download.buffer(input) as T
   throw new Error('Unmapped test dependency '+id)
  },
 }
 ctx.provide('mods',new ModService(env) as never)
}
export function marketPlugin(ctx:Context){ctx.provide('market',new MarketService(ctx))}
export function launchPlugin(ctx:Context){ctx.provide('launch',new LaunchService(ctx))}
export function diagnosticsPlugin(ctx:Context){ctx.provide('diagnostics',new DiagnosticsService(ctx))}
Object.assign(instancesPlugin,{inject:InstanceService.inject})
Object.assign(modsPlugin,{inject:['paths','instances','download']})
Object.assign(marketPlugin,{inject:MarketService.inject})
Object.assign(launchPlugin,{inject:LaunchService.inject})
Object.assign(diagnosticsPlugin,{inject:DiagnosticsService.inject})
