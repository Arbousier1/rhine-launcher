import {describe,it,expect} from 'vitest'
import {LinearFilter,LinearMipmapLinearFilter,HalfFloatType,BackSide,FrontSide} from 'three'
import {vec2,float} from 'three/tsl'
import {archiveOpaqueCapture,archiveBacksideCapture,archiveTransmissionTexture} from '../src/console/rendering/webgpu/materials/frosted-lighting'
describe('native archive transmission filtering parity',()=>{
 it('keeps bilinear taps required by the same bicubic reconstruction as GL',()=>{for(const texture of [archiveOpaqueCapture,archiveBacksideCapture]){expect(texture.magFilter).toBe(LinearFilter);expect(texture.minFilter).toBe(LinearMipmapLinearFilter);expect(texture.type).toBe(HalfFloatType);expect(texture.generateMipmaps).toBe(true);const copy=texture.clone();expect(copy.generateMipmaps).toBe(true);copy.dispose()}})
 it('retains owned capture timing through sampler and mip-level clones',()=>{const first=archiveTransmissionTexture().sample(vec2(.5)) as any,second=first.level(float(2)).sample(vec2(.25));expect((archiveTransmissionTexture() as any).updateBeforeType).toBe('none');expect(first.updateBeforeType).toBe('none');expect(second.updateBeforeType).toBe('none')})
 it('shares captures within a pass but never aliases front and back capture',()=>{expect(archiveTransmissionTexture(FrontSide)).toBe(archiveTransmissionTexture(FrontSide));expect(archiveTransmissionTexture(BackSide)).not.toBe(archiveTransmissionTexture(FrontSide))})
})
