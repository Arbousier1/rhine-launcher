import { ColorManagement, Node, NoBlending, NoToneMapping } from 'three/webgpu';
import type { NodeMaterial, RenderTarget, Texture, TextureNode, UniformNode, Vector2, WebGPURenderer } from 'three/webgpu';
import { NodeUpdateType } from 'three/tsl';
import { smaa } from 'three/addons/tsl/display/SMAANode.js';
import { PostResources, disposeTargetTextures, readyTextureImage } from './resources';
import { abortablePost, throwIfPostAborted, withPostRendererState } from './state';

/** These members are pinned to the installed Three 0.183.2 SMAANode implementation.
 * The public typings omit the image handles and pass materials needed for readiness/ownership.
 * Shader setup is still the ORIGINAL SMAANode.setup, not an approximation or an FXAA substitute.
 */
type SMAAInternals = {
  _renderTargetEdges: RenderTarget;
  _renderTargetWeights: RenderTarget;
  _renderTargetBlend: RenderTarget;
  _materialEdges: NodeMaterial;
  _materialWeights: NodeMaterial;
  _materialBlend: NodeMaterial;
  _areaTexture: Texture;
  _searchTexture: Texture;
  _invSize: UniformNode<'vec2', Vector2>;
  _areaTextureUniform: TextureNode;
  _searchTextureUniform: TextureNode;
  _edgesTextureUniform: TextureNode;
  _weightsTextureUniform: TextureNode;
  _textureNode: TextureNode;
};

async function prepareImage(texture: Texture, signals: readonly (AbortSignal | undefined)[]): Promise<void> {
  throwIfPostAborted(signals);
  if (readyTextureImage(texture)) { texture.needsUpdate = true; return; }
  const image = texture.image as HTMLImageElement;
  let cleanup = () => {};
  const loaded = typeof image.decode === 'function' ? image.decode() : new Promise<void>((resolve, reject) => {
    const onLoad = () => resolve();
    const onError = () => reject(new Error('Could not load the pinned SMAA lookup texture'));
    image.addEventListener('load', onLoad, { once: true });
    image.addEventListener('error', onError, { once: true });
    cleanup = () => { image.removeEventListener('load', onLoad); image.removeEventListener('error', onError); };
    if (image.complete) { if (image.naturalWidth > 0) onLoad(); else onError(); }
  });
  try {
    await abortablePost(loaded, signals);
    throwIfPostAborted(signals);
    if (!readyTextureImage(texture)) throw new Error('Pinned SMAA lookup texture is not decoded');
    texture.needsUpdate = true;
  } finally { cleanup(); }
}

export function createOwnedSMAA(owner: PostResources, input: TextureNode, size: () => { width: number; height: number }) {
  const node = owner.own(smaa(input));
  const internals = node as unknown as SMAAInternals;
  const quad = owner.quad();
  const targets = [internals._renderTargetEdges, internals._renderTargetWeights, internals._renderTargetBlend];
  const materials = [internals._materialEdges, internals._materialWeights, internals._materialBlend];
  const images = [internals._areaTexture, internals._searchTexture];
  let disposed = false;
  const originalDispose = node.dispose.bind(node);
  for (const target of targets) target.samples = 0;
  for (const material of materials) {
    material.blending = NoBlending;
    material.depthTest = material.depthWrite = false;
    material.toneMapped = material.fog = false;
  }

  // FRAME would reuse old pixels when preparation or multiple renders happen in one RAF.
  // No pass here reads its own output node, so RENDER does not recurse through the subpasses.
  node.updateBeforeType = NodeUpdateType.RENDER;
  node.updateBefore = frame => {
    if (disposed) throw new Error('Archive SMAA is disposed');
    if (!images.every(readyTextureImage)) throw new Error('Call await archivePost.prepare() before rendering SMAA');
    const renderer = frame.renderer as WebGPURenderer;
    withPostRendererState(renderer, () => {
      const dimensions = size();
      node.setSize(dimensions.width, dimensions.height);
      renderer.setMRT(null);
      renderer.setRenderObjectFunction(null);
      renderer.setScissorTest(false);
      renderer.setClearColor(0x000000, 1);
      renderer.autoClear = renderer.autoClearColor = renderer.autoClearDepth = renderer.autoClearStencil = true;
      renderer.toneMapping = NoToneMapping;
      renderer.outputColorSpace = ColorManagement.workingColorSpace;
      renderer.xr.enabled = false;
      for (let i = 0; i < targets.length; i++) {
        renderer.setRenderTarget(targets[i]);
        quad.material = materials[i];
        quad.render(renderer);
      }
    });
    return undefined;
  };

  node.dispose = () => {
    if (disposed) return;
    disposed = true;
    // SMAANode's base64 image loads are asynchronous; do not let callbacks resurrect disposed textures.
    for (const texture of images) {
      const image = texture.image as HTMLImageElement;
      image.onload = image.onerror = null;
    }
    try { originalDispose(); }
    finally {
      for (const target of targets) disposeTargetTextures(target);
      for (const uniformNode of [internals._invSize, internals._areaTextureUniform, internals._searchTextureUniform,
        internals._edgesTextureUniform, internals._weightsTextureUniform, internals._textureNode]) uniformNode.dispose();
      for (const material of materials) { material.vertexNode?.dispose(); material.fragmentNode?.dispose(); }
      Node.prototype.dispose.call(node);
    }
  };

  return {
    node,
    isReady: () => !disposed && images.every(readyTextureImage),
    async prepare(signals: readonly (AbortSignal | undefined)[]) {
      if (disposed) throw new Error('Archive SMAA is disposed');
      await Promise.all(images.map(texture => prepareImage(texture, signals)));
      throwIfPostAborted(signals);
    },
  };
}
