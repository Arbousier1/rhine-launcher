import {describe,it,expect} from 'vitest'
import {DepthFormat,UnsignedIntType,HalfFloatType} from 'three/webgpu'
import {PostResources} from '../src/console/rendering/webgpu/post/resources'
describe('native render target aspect contracts',()=>{
 it('samples a depth-only view while retaining at-least-24-bit native depth',()=>{const owner=new PostResources(),target=owner.target('normals',{depth:true,sampledDepth:true,nearest:true,count:2});expect(target.stencilBuffer).toBe(false);expect(target.depthBuffer).toBe(true);expect(target.depthTexture?.format).toBe(DepthFormat);expect(target.depthTexture?.type).toBe(UnsignedIntType);expect(target.textures).toHaveLength(2);expect(target.textures.every(t=>t.type===HalfFloatType)).toBe(true);expect(target.samples).toBe(0);owner.dispose()})
})
