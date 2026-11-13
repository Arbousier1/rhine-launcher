import {BackSide} from 'three/webgpu'
import type {Scene,Camera,Material,WebGPURenderer,RenderTarget,TextureNode,Node} from 'three/webgpu'
import {uv,vec4,float} from 'three/tsl'
import {archiveTransmissionTexture,captureArchiveTransmissionSource,archiveOpaqueCapture} from '../materials/frosted-lighting'
import type {PostResources} from './resources'
/**
 * Preserve the legacy back-side optical capture while reusing the already
 * drawn opaque color instead of re-rendering the whole opaque scene.
 */
export class ArchiveTransmissionPass{
 private readonly quad
 private readonly copyMaterial
 constructor(private owner:PostResources){
  this.quad=owner.quad()
  const sample=archiveTransmissionTexture(BackSide).sample(uv()) as unknown as TextureNode
  sample.levelNode=float(0)
  this.copyMaterial=owner.material('ArchivePost.copyOpaque',vec4(sample as unknown as Node<'vec4'>))
 }
 render(renderer:WebGPURenderer,scene:Scene,camera:Camera,beauty:RenderTarget,capture:RenderTarget){
  const opaque=renderer.opaque,transparent=renderer.transparent,autoClear=renderer.autoClear
  const renderObject=renderer.getRenderObjectFunction(),target=renderer.getRenderTarget()
  const background=scene.background,backgroundNode=scene.backgroundNode
  const sides=new Map<Material,Material['side']>()
  scene.traverse(object=>{const material=(object as any).material as Material|Material[]|undefined;for(const value of material?(Array.isArray(material)?material:[material]):[])sides.set(value,value.side)})
  try{
   renderer.setMRT(null)
   renderer.setRenderTarget(beauty)
   renderer.setRenderObjectFunction(renderObject)
   renderer.opaque=true;renderer.transparent=false;renderer.autoClear=true
   renderer.render(scene,camera)
   captureArchiveTransmissionSource(renderer,BackSide)
   renderer.setRenderObjectFunction(null)
   renderer.setRenderTarget(capture)
   renderer.autoClear=false
   renderer.clear(true,true,true)
   this.quad.material=this.copyMaterial
   this.quad.render(renderer)
   scene.background=null;scene.backgroundNode=null
   renderer.opaque=false;renderer.transparent=true;renderer.autoClear=false
   renderer.setRenderObjectFunction((object,renderScene,cam,geometry,material,group,lights,clipping,passId)=>{
    if(passId!=='backSide')return
    const side=material.side
    try{material.side=sides.get(material)??side;renderer.renderObject(object,renderScene,cam,geometry,material,group,lights,clipping,passId)}
    finally{material.side=side}
   })
   renderer.render(scene,camera)
   captureArchiveTransmissionSource(renderer,0)
   renderer.setRenderTarget(beauty)
   renderer.autoClear=false
   renderer.setRenderObjectFunction((object,renderScene,cam,geometry,material,group,lights,clipping,passId)=>{
    if(passId==='backSide')return
    const side=material.side
    try{material.side=sides.get(material)??side;if(renderObject)renderObject(object,renderScene,cam,geometry,material,group,lights,clipping,passId);else renderer.renderObject(object,renderScene,cam,geometry,material,group,lights,clipping,passId)}
    finally{material.side=side}
   })
   renderer.render(scene,camera)
  }finally{
   scene.background=background;scene.backgroundNode=backgroundNode
   for(const [material,side]of sides)material.side=side
   renderer.setRenderObjectFunction(renderObject)
   renderer.setRenderTarget(target)
   renderer.opaque=opaque;renderer.transparent=transparent;renderer.autoClear=autoClear
  }
 }
}
