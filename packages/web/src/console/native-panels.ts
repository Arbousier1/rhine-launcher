import type {FeatureEnvironment} from '@rhine/plugin-api'
import {getLauncherSnapshot,subscribeStatus} from './launcher-bridge'
export interface NativePanelInput{root:HTMLElement;instanceId?:string;notify?:(message:string)=>void;[key:string]:unknown}
export interface NativePanelHandle{dispose():void}
export interface NativePanelContext{
 root:HTMLElement;input:NativePanelInput;signal:AbortSignal
 call<T>(id:string,input?:Record<string,unknown>,signal?:AbortSignal):Promise<T>
 cleanupCall<T>(id:string,input?:Record<string,unknown>):Promise<T>
 snapshot:typeof getLauncherSnapshot
 listen(target:EventTarget,event:string,handler:EventListener,options?:AddEventListenerOptions):void
 onDispose(callback:()=>void):void
 subscribe(callback:()=>void):()=>void
 notify(message:string):void
}
interface PanelState{mounts:Set<NativePanelHandle>;cleanupUse?:<T>(cap:string,payload:Record<string,unknown>)=>T}
const state=(env:FeatureEnvironment,id:string)=>env.state<PanelState>('native-panel:'+id,()=>({mounts:new Set()}))
/** One registry inverse per panel fiber, not one accumulating inverse per reopen. */
export function setupNativePanel(env:FeatureEnvironment,id:string){const entry=state(env,id);entry.cleanupUse=<T>(cap:string,payload:Record<string,unknown>)=>env.use<T>(cap,payload);env.onDispose(()=>{for(const mount of [...entry.mounts])mount.dispose();entry.mounts.clear();entry.cleanupUse=undefined})}
export function mountNativePanel(env:FeatureEnvironment,id:string,input:NativePanelInput,render:(ctx:NativePanelContext)=>void|Promise<void>):NativePanelHandle{
 const controller=new AbortController(),signal=AbortSignal.any([env.signal,controller.signal]),cleanup:(()=>void)[]=[],entry=state(env,id);let disposed=false
 const handle:NativePanelHandle={dispose(){if(disposed)return;disposed=true;controller.abort();for(const release of cleanup.reverse()){try{release()}catch{}}entry.mounts.delete(handle);input.root.replaceChildren()}}
 const ctx:NativePanelContext={root:input.root,input,signal,snapshot:getLauncherSnapshot,
  async call<T>(cap:string,payload:Record<string,unknown>={},extra?:AbortSignal){signal.throwIfAborted();return env.use<T|Promise<T>>(cap,{...payload,signal:extra?AbortSignal.any([signal,extra]):signal})},
  async cleanupCall<T>(cap:string,payload:Record<string,unknown>={}){if(!entry.cleanupUse)throw new Error("面板已卸载");return entry.cleanupUse<T|Promise<T>>(cap,payload)},
  listen(target,event,handler,options={}){target.addEventListener(event,handler,{...options,signal})},
  onDispose(fn){if(disposed)fn();else cleanup.push(fn)},
  subscribe(fn){const release=subscribeStatus(()=>{if(!signal.aborted)fn()});cleanup.push(release);return release},
  notify(message){if(!signal.aborted)input.notify?.(message)},
 }
 entry.mounts.add(handle)
 Promise.resolve().then(()=>{signal.throwIfAborted();return render(ctx)}).catch(error=>{if(!signal.aborted){const message=document.createElement('p');message.className='launcher-action-feedback is-error';message.setAttribute('role','alert');message.textContent=error instanceof Error?error.message:String(error);input.root.append(message)}})
 return handle
}
