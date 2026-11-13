import type {FeatureEnvironment} from '@rhine/plugin-api'
import {subscribeStatus} from '../../launcher-bridge'
export interface SurfaceInput{root:HTMLElement;notify?:(message:string)=>void}
export interface SurfaceHandle{dispose():void}
/**
 * Owned surface lifetime: one AbortController for listeners, one status
 * subscription, and a single teardown path. Mirrors DSH surface plugins,
 * which never leave a listener behind after their fiber unloads.
 */
export function mountSurface(env:FeatureEnvironment,input:SurfaceInput,draw:(rerender:()=>void,signal:AbortSignal)=>void):SurfaceHandle{
 const controller=new AbortController(),signal=AbortSignal.any([env.signal,controller.signal])
 const rerender=()=>{if(!signal.aborted)draw(rerender,signal)}
 const unsubscribe=subscribeStatus(()=>rerender())
 env.onDispose(()=>{controller.abort();unsubscribe();input.root.replaceChildren()})
 rerender()
 return {dispose(){controller.abort();unsubscribe();input.root.replaceChildren()}}
}
