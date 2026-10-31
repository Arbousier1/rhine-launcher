import type {FeatureEnvironment} from '@rhine/plugin-api'
/** Reversible native UI effects. No globals are monkey-patched. */
export function ownedEffects(env:FeatureEnvironment){
 const releases:(()=>void|Promise<void>)[]=[],frames=new Set<number>(),timers=new Set<number>();let closed=false
 type Events=WindowEventMap & DocumentEventMap & FontFaceSetEventMap
 const add=(release:()=>void|Promise<void>)=>{if(closed){void release();return}releases.push(release)}
 const listen=<K extends string>(target:EventTarget|null|undefined,name:K,handler:(event:K extends keyof Events?Events[K]:Event)=>void,options?:boolean|AddEventListenerOptions)=>{
  if(!target||closed)return
  const listener=handler as EventListener
  target.addEventListener(name,listener,options)
  add(()=>target.removeEventListener(name,listener,options))
 }
 const requestAnimationFrame=(callback:FrameRequestCallback):number=>{
  if(closed)return 0
  const id=window.requestAnimationFrame(time=>{frames.delete(id);if(!closed)callback(time)})
  frames.add(id);return id
 }
 const cancelAnimationFrame=(id:number)=>{frames.delete(id);window.cancelAnimationFrame(id)}
 const setTimeout=(callback:(...args:any[])=>void,delay=0):number=>{
  if(closed)return 0
  const id=window.setTimeout(()=>{timers.delete(id);if(!closed)callback()},delay)
  timers.add(id);return id
 }
 const clearTimeout=(id:number|undefined)=>{if(id!==undefined){timers.delete(id);window.clearTimeout(id)}}
 env.onDispose(async()=>{
  closed=true
  for(const id of frames)window.cancelAnimationFrame(id)
  for(const id of timers)window.clearTimeout(id)
  frames.clear();timers.clear()
  const errors:unknown[]=[]
  for(const release of releases.reverse()){try{await release()}catch(error){errors.push(error)}}
  if(errors.length)throw new AggregateError(errors,"Native UI cleanup failed")
 })
 return {add,listen,requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,get closed(){return closed}}
}
