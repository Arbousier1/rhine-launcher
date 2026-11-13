import { FeatureRuntime } from '@rhine/plugin-api'
import theme from './plugins/theme-life.plugin.ts'
import layout from './plugins/layout-hybrid.plugin.ts'
import hints from './plugins/advanced-hints.plugin.ts'
import nativeFiles from './plugins/native-file-path.plugin.ts'
export async function installUiExtensions(target: Window = window) {
 const runtime=new FeatureRuntime()
 runtime.register(theme);runtime.register(layout);runtime.register(hints);runtime.register(nativeFiles)
 let disabled:string[]=[]
 try{const value=JSON.parse(target.localStorage.getItem('rhine.ui.disabled')??'[]');if(Array.isArray(value))disabled=value.filter(v=>typeof v==='string')}catch{/* Fresh preferences. */}
 await runtime.start({disabled})
 const host={
  snapshot:()=>runtime.list(),
  async enable(id:string){await runtime.enable(id);disabled=disabled.filter(v=>v!==id);target.localStorage.setItem('rhine.ui.disabled',JSON.stringify(disabled))},
  async disable(id:string){await runtime.disable(id);if(!disabled.includes(id))disabled.push(id);target.localStorage.setItem('rhine.ui.disabled',JSON.stringify(disabled))},
  dispose:()=>runtime.dispose(),
 }
 Object.defineProperty(target,'rhineUi',{value:host,configurable:true})
 target.addEventListener('pagehide',()=>{void host.dispose()},{once:true})
 return host
}
