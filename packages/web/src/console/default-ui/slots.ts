import type {FeatureEnvironment} from '@rhine/plugin-api'
/**
 * Contribution slot, mirroring DSH's client slot model: surfaces register
 * themselves, the layout enumerates the slot and renders the active one.
 * The registry is shared non-plugin data; it exposes no capability of its own.
 */
export interface SurfaceEntry{
 /** Capability of the plugin that renders this surface. */
 capability:string
 /** Locale key used for the tab label. */
 labelKey:string
 /** Stable sort order; smaller renders first. */
 order:number
}
interface SurfaceState{items:Map<string,SurfaceEntry>;listeners:Set<()=>void>}
const slotState=(env:FeatureEnvironment)=>env.state<SurfaceState>('console.surface.slot',()=>({items:new Map(),listeners:new Set()}))
export function contributeSurface(env:FeatureEnvironment,entry:SurfaceEntry):void{
 const state=slotState(env)
 state.items.set(entry.capability,entry)
 for(const listener of [...state.listeners])listener()
 env.onDispose(()=>{state.items.delete(entry.capability);for(const listener of [...state.listeners])listener()})
}
export function listSurfaces(env:FeatureEnvironment):SurfaceEntry[]{
 return [...slotState(env).items.values()].sort((a,b)=>a.order-b.order||a.capability.localeCompare(b.capability))
}
export function subscribeSurfaces(env:FeatureEnvironment,listener:()=>void):()=>void{
 const state=slotState(env);state.listeners.add(listener)
 return()=>state.listeners.delete(listener)
}
