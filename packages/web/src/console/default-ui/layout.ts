import type {FeatureEnvironment} from '@rhine/plugin-api'
import {getLauncherSnapshot,loadLauncher,subscribeStatus,setSelectedAccount} from '../launcher-bridge'
import {esc} from './dom'
import {t} from './locale'
import {listSurfaces,subscribeSurfaces,type SurfaceEntry} from './slots'
import {shellState} from './shell-state'

export interface LayoutInput{root:HTMLElement;notify?:(message:string)=>void}
export interface LayoutHandle{dispose():void}

/**
 * Layout only: chrome, slot enumeration and surface switching. It renders no
 * launcher feature of its own, so every page can be unloaded independently.
 */
export function mountLayout(env:FeatureEnvironment,input:LayoutInput):LayoutHandle{
 const controller=new AbortController(),signal=AbortSignal.any([env.signal,controller.signal])
 const state=shellState(env)
 const host=input.root
 host.innerHTML='<div class="dft-app"><header class="dft-top"><div class="dft-brand">RHINE LAB<small>LAUNCHER</small></div>'
  +'<nav class="dft-nav" role="tablist" data-nav></nav><div class="dft-spacer"></div><span data-account></span></header>'
  +'<div class="dft-body"><aside class="dft-side" data-side></aside><main class="dft-main" data-stage></main></div>'
  +'<footer class="dft-footer" data-footer></footer></div>'
 const nav=host.querySelector<HTMLElement>('[data-nav]')!
 const stage=host.querySelector<HTMLElement>('[data-stage]')!
 const side=host.querySelector<HTMLElement>('[data-side]')!
 const footer=host.querySelector<HTMLElement>('[data-footer]')!
 const account=host.querySelector<HTMLElement>('[data-account]')!
 let active:string|undefined
 let mount:LayoutHandle|undefined

 /** Each surface is one feature; the layout only asks it to render. */
 const switchTo=async(capability:string)=>{
  if(signal.aborted)return
  const entry=listSurfaces(env).find(s=>s.capability===capability)
  if(!entry)return
  mount?.dispose();mount=undefined;active=capability
  stage.replaceChildren();side.replaceChildren()
  try{await env.use<Promise<unknown>>(capability,{root:active===capability?stage:stage,notify:input.notify})}
  catch(error){stage.innerHTML='<p class="dft-alert" role="alert">'+esc(error instanceof Error?error.message:String(error))+'</p>'}
 }
 const paintNav=()=>{
  const surfaces=listSurfaces(env)
  if(!active&&surfaces.length)void switchTo(surfaces[0].capability)
  nav.innerHTML=surfaces.map(s=>'<button role="tab" data-surface="'+esc(s.capability)+'" aria-selected="'+(s.capability===active)+'">'+esc(t(s.labelKey))+'</button>').join('')
 }
 const paintAccount=()=>{const snapshot=getLauncherSnapshot()
  account.innerHTML='<label class="dft-step">账户<select data-account-select style="max-width:190px">'
   +(snapshot.accounts.length?snapshot.accounts.map(a=>'<option value="'+esc(a.id)+'"'+(a.id===snapshot.selectedAccountId?' selected':'')+'>'+esc(a.name)+'</option>').join(''):'<option value="">未添加账户</option>')
   +'</select></label>'}
 const paintFooter=()=>{const snapshot=getLauncherSnapshot()
  footer.innerHTML='<span><i class="dft-dot '+(snapshot.status==='ready'?'ok':snapshot.status==='error'?'bad':'')+'"></i> '
   +esc(snapshot.status==='loading'?'正在连接':snapshot.status==='error'?(snapshot.error?.message??'连接失败'):'已连接')+'</span>'
   +'<span>'+esc(snapshot.connection==='connected'?'实时同步':snapshot.connection==='disabled'?'实时已停用':'离线快照')+'</span>'
   +'<span>'+snapshot.instances.length+' 个实例 · '+snapshot.accounts.length+' 个账户</span>'}
 nav.addEventListener('click',(event:Event)=>{
  const button=(event.target as Element).closest<HTMLButtonElement>('[data-surface]')
  if(button?.dataset.surface)void switchTo(button.dataset.surface)
 },{signal})
 account.addEventListener('change',(event:Event)=>{
  const target=event.target as HTMLSelectElement
  if(target.dataset.accountSelect!==undefined){try{setSelectedAccount(target.value)}catch(error){input.notify?.(error instanceof Error?error.message:String(error))}}
 },{signal})
 const unsubscribeNav=subscribeSurfaces(env,paintNav)
 const unsubscribeStatus=subscribeStatus(()=>{paintAccount();paintFooter()})
 env.onDispose(()=>{controller.abort();unsubscribeNav();unsubscribeStatus();mount?.dispose();input.root.replaceChildren()})
 paintNav();paintAccount();paintFooter()
 void loadLauncher().then(()=>{paintAccount();paintFooter()}).catch(()=>{})
 return {dispose(){controller.abort();unsubscribeNav();unsubscribeStatus();mount?.dispose();input.root.replaceChildren()}}
}
