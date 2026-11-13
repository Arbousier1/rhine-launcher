import type {RenderQuality} from '../render-quality'
export type RendererPreference='auto'|'webgpu'|'webgl2'
/**
 * Measured on this scene (docs/RENDER-BACKEND.md): WebGPU showed no render
 * benefit and ~4x higher CPU than the established WebGL 2 pipeline.
 * Keep automatic selection off; WebGPU stays available via ?renderer=webgpu.
 */
export const NATIVE_AUTOMATIC_ENABLED=false
export function rendererPreference(value:unknown):RendererPreference{return value==='webgpu'||value==='webgl2'?value:'auto'}
export function nativeQualitySupported(quality:RenderQuality,superPerformance=false){return quality.transmission===1}
export function shouldTryNative(preference:RendererPreference,available:boolean,quality:RenderQuality,superPerformance=false,validated=NATIVE_AUTOMATIC_ENABLED){return preference!=='webgl2'&&available&&nativeQualitySupported(quality,superPerformance)&&(preference==='webgpu'||validated)}
