import {describe,it,expect} from 'vitest'
import {rendererPreference,nativeQualitySupported,shouldTryNative} from '../src/console/rendering/policy'
import {qualityPresets} from '../src/console/render-quality'
describe('render backend choice is explicit and quality preserving',()=>{
 it('normalizes only documented renderer choices',()=>{expect(rendererPreference('webgpu')).toBe('webgpu');expect(rendererPreference('webgl2')).toBe('webgl2');expect(rendererPreference('unknown')).toBe('auto');expect(rendererPreference(null)).toBe('auto')})
 it('keeps automatic native use gated until equal-quality validation',()=>{expect(shouldTryNative('auto',true,qualityPresets.original,false,false)).toBe(false);expect(shouldTryNative('auto',true,qualityPresets.original,false,true)).toBe(true)})
 it('honors explicit compatibility and missing adapters',()=>{expect(shouldTryNative('webgl2',true,qualityPresets.original,false,true)).toBe(false);expect(shouldTryNative('webgpu',false,qualityPresets.original)).toBe(false);expect(shouldTryNative('webgpu',true,qualityPresets.original)).toBe(true)})
 it('does not silently ignore unsupported transmission resolution even in fast mode',()=>{for(const transmission of [.25,.5,.75]){const q={...qualityPresets.original,transmission};expect(nativeQualitySupported(q)).toBe(false);expect(shouldTryNative('webgpu',true,q,true,true)).toBe(false)}expect(nativeQualitySupported(qualityPresets.ultra)).toBe(true)})
})
