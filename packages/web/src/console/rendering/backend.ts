import type * as THREE from 'three'
import type {LightingLook} from '../archive-lighting'
import type {RenderQuality} from '../render-quality'
export type ArchiveBackendKind='webgl2'|'webgpu'
export interface AOControls{enabled:boolean;kernelRadius:number;minDistance:number;maxDistance:number;width:number;height:number}
export interface BokehControls{enabled:boolean;uniforms:Record<string,{value:any}>}
export interface BackendMetrics{drawCalls:number;triangles:number;submittedFrames:number;deferredFrames:number}
/** One complete graphics backend; simulation and UI never depend on renderer-specific methods. */
export interface ArchiveBackend{
 readonly kind:ArchiveBackendKind;readonly canvas:HTMLCanvasElement
 readonly maxTextureSize:number;readonly maxAnisotropy:number;readonly coordinateSystem:THREE.CoordinateSystem
 readonly ao:AOControls;readonly bokeh:BokehControls;readonly smaa:{enabled:boolean}
 readonly metrics:BackendMetrics;readonly epoch:number
 toneMappingExposure:number;shadowsEnabled:boolean
 onInvalidated?:()=>void;onLost?:(reason:string)=>void
 createLighting(look:LightingLook):THREE.DirectionalLight
 configure(quality:RenderQuality,superPerformance:boolean):void
 resizeShadow(light:THREE.DirectionalLight,size:number):void
 resize(host:HTMLElement,quality:RenderQuality,superPerformance:boolean):{width:number;height:number;ratio:number;limited:boolean}
 prepareMaterials():void
 prepareVariant(signal:AbortSignal,superPerformance:boolean):Promise<void>
 clearPreparedOutput(signal:AbortSignal):Promise<void>
 canSubmit():boolean;resetAdmission():void;resetInfo():void
 render(shadowDirty:boolean,superPerformance:boolean):void
 dispose():void
}
export type ArchiveBackendFactory=(host:HTMLElement,scene:THREE.Scene,camera:THREE.PerspectiveCamera,look:LightingLook)=>ArchiveBackend
