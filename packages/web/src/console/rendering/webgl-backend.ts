import * as THREE from 'three'
import {EffectComposer} from 'three/addons/postprocessing/EffectComposer.js'
import {RenderPass} from 'three/addons/postprocessing/RenderPass.js'
import {OutputPass} from 'three/addons/postprocessing/OutputPass.js'
import {SMAAPass} from 'three/addons/postprocessing/SMAAPass.js'
import {SharedDepthAO,SharedDepthBokeh} from '../shared-depth'
import {createArchiveLighting,type LightingLook} from '../archive-lighting'
import {applyTextureQuality,resizeQuality} from '../quality-renderer'
import {GpuSubmissionGate} from '../gpu-submission'
import {waitForShaderPrograms,type PreparedProgram} from '../shader-readiness'
import {waitForGpuPreparation} from '../gpu-preparation'
import type {RenderQuality} from '../render-quality'
import type {ArchiveBackend,BackendMetrics,BokehControls} from './backend'
/** The full established GLSL path remains the compatibility backend. */
export class WebGLArchiveBackend implements ArchiveBackend{
 readonly kind='webgl2' as const;readonly coordinateSystem=THREE.WebGLCoordinateSystem
 readonly renderer:THREE.WebGLRenderer;readonly composer:EffectComposer;readonly canvas:HTMLCanvasElement
 ao:SharedDepthAO;bokeh:SharedDepthBokeh&BokehControls;smaa=new SMAAPass()
 private gate:GpuSubmissionGate;private kernel=32;private resources:THREE.WebGLRenderTarget[]=[];private events=new AbortController();private disposed=false
 epoch=0;onInvalidated?:()=>void;onLost?:(reason:string)=>void
 constructor(host:HTMLElement,private scene:THREE.Scene,private camera:THREE.PerspectiveCamera,look:LightingLook='baseline'){
  const renderer=this.renderer=new THREE.WebGLRenderer({antialias:true,alpha:false,powerPreference:'high-performance'});this.canvas=renderer.domElement
  this.gate=new GpuSubmissionGate(renderer.getContext() as WebGL2RenderingContext)
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.5)*Math.min(innerWidth/1920,innerHeight/1080));renderer.setSize(host.clientWidth,host.clientHeight)
  renderer.info.autoReset=false;renderer.shadowMap.enabled=true;renderer.shadowMap.autoUpdate=false;renderer.shadowMap.type=THREE.PCFSoftShadowMap;renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.05
  this.canvas.addEventListener('webglcontextrestored',()=>{this.gate.reset();this.epoch++;this.onInvalidated?.()},{signal:this.events.signal})
  this.composer=new EffectComposer(renderer);this.composer.addPass(new RenderPass(scene,camera));this.ao=new SharedDepthAO(scene,camera,host.clientWidth,host.clientHeight)
  this.ao.kernelRadius=look==='refined'?.44:.38;this.ao.minDistance=.001;this.ao.maxDistance=.09;this.composer.addPass(this.ao)
  this.bokeh=new SharedDepthBokeh(scene,camera,{focus:25,aperture:.0018,maxblur:.011},()=>this.ao) as SharedDepthBokeh&BokehControls;this.composer.addPass(this.bokeh);this.smaa.enabled=false;this.composer.addPass(this.smaa);this.composer.addPass(new OutputPass())
 }
 get maxTextureSize(){return this.renderer.capabilities.maxTextureSize}
 get maxAnisotropy(){return this.renderer.capabilities.getMaxAnisotropy()}
 get toneMappingExposure(){return this.renderer.toneMappingExposure}set toneMappingExposure(value:number){this.renderer.toneMappingExposure=value}
 get shadowsEnabled(){return this.renderer.shadowMap.enabled}set shadowsEnabled(value:boolean){this.renderer.shadowMap.enabled=value}
 get metrics():BackendMetrics{return {drawCalls:this.renderer.info.render.calls,triangles:this.renderer.info.render.triangles,submittedFrames:this.gate.submittedFrames,deferredFrames:this.gate.deferredFrames}}
 createLighting(look:LightingLook){return createArchiveLighting(this.renderer,this.scene,look,target=>this.resources.push(target))}
 configure(quality:RenderQuality,_superPerformance:boolean){
  if(quality.aoSamples&&quality.aoSamples!==this.kernel){const old=this.ao,next=new SharedDepthAO(this.scene,this.camera,1,1,quality.aoSamples);next.kernelRadius=old.kernelRadius;next.minDistance=old.minDistance;next.maxDistance=old.maxDistance;const index=this.composer.passes.indexOf(old);this.composer.removePass(old);this.composer.insertPass(next,index);this.ao=next;old.dispose();this.kernel=quality.aoSamples;this.epoch++}
  this.ao.enabled=quality.aoSamples>0;this.bokeh.enabled=quality.depthOfField>0;this.smaa.enabled=quality.antialias==='smaa';this.shadowsEnabled=quality.shadows>0;applyTextureQuality(this.scene,this.renderer,quality)
 }
 resizeShadow(light:THREE.DirectionalLight,size:number){if(light.shadow.mapSize.x!==size){light.shadow.map?.dispose();light.shadow.map=null;light.shadow.mapSize.set(size,size)}light.shadow.needsUpdate=true}
 resize(host:HTMLElement,quality:RenderQuality,superPerformance:boolean){const dimensions=resizeQuality(this.renderer,this.composer,host,quality,superPerformance);this.ao.setSize(Math.max(1,Math.floor(dimensions.width*quality.aoResolution)),Math.max(1,Math.floor(dimensions.height*quality.aoResolution)));this.ao.setSharing(this.ao.enabled&&this.bokeh.enabled&&quality.aoResolution===1&&!superPerformance);return dimensions}
 prepareMaterials(){}
 async prepareVariant(signal:AbortSignal,superPerformance:boolean){const materials=this.renderer.compile(this.scene,this.camera),programs=[...new Set([...materials].map(material=>(this.renderer.properties.get(material) as {currentProgram:PreparedProgram}).currentProgram))];await waitForShaderPrograms(programs,signal);this.renderer.shadowMap.needsUpdate=true;if(superPerformance)this.renderer.render(this.scene,this.camera);else this.composer.render();await waitForGpuPreparation(this.renderer.getContext() as WebGL2RenderingContext,signal)}
 async clearPreparedOutput(signal:AbortSignal){const target=this.renderer.getRenderTarget(),color=this.renderer.getClearColor(new THREE.Color()),alpha=this.renderer.getClearAlpha();this.renderer.setRenderTarget(null);this.renderer.setClearColor(this.scene.background as THREE.Color,1);this.renderer.clear();this.renderer.setClearColor(color,alpha);this.renderer.setRenderTarget(target);await waitForGpuPreparation(this.renderer.getContext() as WebGL2RenderingContext,signal)}
 canSubmit(){return this.gate.ready()}resetAdmission(){this.gate.reset();this.renderer.shadowMap.needsUpdate=true}resetInfo(){this.renderer.info.reset()}
 render(shadowDirty:boolean,superPerformance:boolean){this.renderer.shadowMap.needsUpdate=shadowDirty;if(superPerformance)this.renderer.render(this.scene,this.camera);else this.composer.render();this.gate.submitted()}
 dispose(){if(this.disposed)return;this.disposed=true;this.events.abort();this.gate.dispose();for(const pass of this.composer.passes)pass.dispose();this.composer.dispose();for(const resource of this.resources)resource.dispose();this.resources=[];this.renderer.dispose();this.renderer.forceContextLoss();this.canvas.remove()}
}
