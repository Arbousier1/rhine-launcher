import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { SMAAPass } from "three/addons/postprocessing/SMAAPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { renderDimensions, type RenderQuality } from "./render-quality";

export function applyTextureQuality(
  root: THREE.Object3D,
  renderer: THREE.WebGLRenderer,
  quality: RenderQuality,
) {
  const maximum = Math.min(
    quality.anisotropy,
    renderer.capabilities.getMaxAnisotropy(),
  );
  const textures = new Set<THREE.Texture>();
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    for (const material of Array.isArray(object.material)
      ? object.material
      : [object.material]) {
      for (const value of Object.values(material)) {
        if (value instanceof THREE.Texture && !value.isRenderTargetTexture)
          textures.add(value);
      }
    }
  });
  for (const texture of textures) {
    if (texture.anisotropy === maximum) continue;
    texture.anisotropy = maximum;
    texture.needsUpdate = true;
  }
}

const sizedTargets=new WeakMap<THREE.WebGLRenderer,{composer:EffectComposer;physicalWidth:number;physicalHeight:number;width:number;height:number;ratio:number}>();

export function resizeQuality(
  renderer: THREE.WebGLRenderer,
  composer: EffectComposer,
  host: HTMLElement,
  quality: RenderQuality,
  superPerformance = false,
) {
  const width = Math.max(1, host.clientWidth),
    height = Math.max(1, host.clientHeight);
  const dimensions = renderDimensions(
    quality,
    width,
    height,
    host.getBoundingClientRect().width / width,
    devicePixelRatio,
    renderer.capabilities.maxTextureSize,
    superPerformance ? 921_600 : 8_294_400,
  );
  const prior=sizedTargets.get(renderer),previous=prior?.composer===composer?prior:undefined,physicalWidth=dimensions.width,physicalHeight=dimensions.height;
  // Boot and archive can have different logical stage sizes but the same actual pixels.
  // Resizing those identical targets discards already prepared GPU buffers at ENTER SYSTEM.
  if(!previous||previous.composer!==composer||previous.physicalWidth!==physicalWidth||previous.physicalHeight!==physicalHeight){
    if(!previous||previous.ratio!==dimensions.ratio){renderer.setPixelRatio(dimensions.ratio);composer.setPixelRatio(dimensions.ratio)}
    if(!previous||previous.width!==width||previous.height!==height){renderer.setSize(width,height);composer.setSize(width,height)}
    sizedTargets.set(renderer,{composer,physicalWidth,physicalHeight,width,height,ratio:dimensions.ratio});
  }
  renderer.domElement.style.width=width+"px";renderer.domElement.style.height=height+"px";
  renderer.transmissionResolutionScale = quality.transmission;
  host.dataset.renderQuality = JSON.stringify({
    ...dimensions,
    antialias: quality.antialias,
    transmission: quality.transmission,
    anisotropy: Math.min(
      quality.anisotropy,
      renderer.capabilities.getMaxAnisotropy(),
    ),
    superPerformance,
  });
  return dimensions;
}

export function createViewerPipeline(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
) {
  const composer = new EffectComposer(renderer);
  const smaa = new SMAAPass();
  composer.addPass(new RenderPass(scene, camera));
  composer.addPass(smaa);
  composer.addPass(new OutputPass());
  return { composer, smaa };
}
