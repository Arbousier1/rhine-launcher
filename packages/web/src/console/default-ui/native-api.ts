import type {FeaturePlugin} from '@rhine/plugin-api'
import {getLauncherRuntime} from '../launcher-bridge'
/**
 * Surface discovery, mirroring DSH's one-package-one-capability rule: every
 * *.plugin.ts under surfaces/ is one surface feature and is registered alone.
 */
const surfaces=import.meta.glob<FeaturePlugin>('./surfaces/*.plugin.ts',{eager:true,import:'default'})
const shell=import.meta.glob<FeaturePlugin>('./shell.plugin.ts',{eager:true,import:'default'})
const installed=new WeakMap<ReturnType<typeof getLauncherRuntime>,Promise<void>>()
export function installDefaultUi():Promise<void>{
 const runtime=getLauncherRuntime()
 let ready=installed.get(runtime)
 if(!ready){
  ready=(async()=>{
   for(const [source,plugin]of Object.entries({...surfaces,...shell})){
    if(!runtime.definition(plugin.id))runtime.register(plugin,source)
   }
   await runtime.settled()
   for(const plugin of Object.values({...surfaces,...shell}))await runtime.enable(plugin.id)
  })()
  installed.set(runtime,ready)
 }
 return ready
}
export const shellPlugin=Object.values(shell)[0]
