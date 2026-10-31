import {createContext,useContext,useEffect} from 'react'
import type {EffectCallback,DependencyList} from 'react'
export interface EffectOwner { own(dispose:()=>void|Promise<void>):()=>void }
export const EffectOwnerContext=createContext<EffectOwner|null>(null)
/** A React effect is also a revertible effect of its single feature's Cordis fiber. */
export function useOwnedEffect(effect:EffectCallback,deps?:DependencyList):void {
 const owner=useContext(EffectOwnerContext)
 useEffect(()=>{
  const dispose=effect()
  if(!dispose)return
  let done=false
  const release=()=>{if(done)return;done=true;dispose()}
  const remove=owner?.own(release)
  return()=>{remove?.();release()}
 },deps)
}
