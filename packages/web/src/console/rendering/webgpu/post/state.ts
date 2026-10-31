import { Color, Vector4 } from 'three/webgpu';
import type { Material, Object3D, Scene, WebGPURenderer } from 'three/webgpu';

/** RenderPipeline/RendererUtils r183 are not exception-safe and omit some state. */
export function savePostRendererState(renderer: WebGPURenderer) {
  return {
    target: renderer.getRenderTarget(),
    cubeFace: renderer.getActiveCubeFace(),
    mipLevel: renderer.getActiveMipmapLevel(),
    mrt: renderer.getMRT(),
    renderObject: renderer.getRenderObjectFunction(),
    clearColor: renderer.getClearColor(Object.assign(new Color(), { a: 1 })),
    clearAlpha: renderer.getClearAlpha(),
    autoClear: renderer.autoClear,
    autoClearColor: renderer.autoClearColor,
    autoClearDepth: renderer.autoClearDepth,
    autoClearStencil: renderer.autoClearStencil,
    toneMapping: renderer.toneMapping,
    exposure: renderer.toneMappingExposure,
    outputColorSpace: renderer.outputColorSpace,
    xrEnabled: renderer.xr.enabled,
    viewport: renderer.getViewport(new Vector4()),
    scissor: renderer.getScissor(new Vector4()),
    scissorTest: renderer.getScissorTest(),
  };
}
export type PostRendererState = ReturnType<typeof savePostRendererState>;

export function restorePostRendererState(renderer: WebGPURenderer, state: PostRendererState): void {
  renderer.toneMapping = state.toneMapping;
  renderer.toneMappingExposure = state.exposure;
  renderer.outputColorSpace = state.outputColorSpace;
  renderer.xr.enabled = state.xrEnabled;
  renderer.autoClear = state.autoClear;
  renderer.autoClearColor = state.autoClearColor;
  renderer.autoClearDepth = state.autoClearDepth;
  renderer.autoClearStencil = state.autoClearStencil;
  renderer.setMRT(state.mrt);
  renderer.setRenderObjectFunction(state.renderObject);
  renderer.setClearColor(state.clearColor, state.clearAlpha);
  renderer.setRenderTarget(state.target, state.cubeFace, state.mipLevel);
  renderer.setViewport(state.viewport);
  renderer.setScissor(state.scissor);
  renderer.setScissorTest(state.scissorTest);
}

export function withPostRendererState<T>(renderer: WebGPURenderer, draw: (state: PostRendererState) => T): T {
  const state = savePostRendererState(renderer);
  try { return draw(state); }
  finally { restorePostRendererState(renderer, state); }
}

/** r183's transparent double-pass traversal can leave a source material on BackSide if a draw throws. */
export function saveMaterialSides(scene: Scene): () => void {
  const sides = new Map<Material, Material['side']>();
  scene.traverse(object => {
    const source = (object as Object3D & { material?: Material | Material[] }).material;
    for (const material of source ? (Array.isArray(source) ? source : [source]) : []) {
      if (!sides.has(material)) sides.set(material, material.side);
    }
  });
  return () => { for (const [material, side] of sides) material.side = side; };
}

/** Source SharedDepthAO excludes these only during AO/shared depth. The standalone BokehPass does not. */
export function hideAOExcluded(scene: Scene): () => void {
  const hidden: Object3D[] = [];
  scene.traverse(object => {
    const kind = object as Object3D & { isLine?: boolean; isLine2?: boolean; isPoints?: boolean };
    if (object.visible && (object.userData.excludeFromAO || kind.isLine || kind.isLine2 || kind.isPoints)) {
      hidden.push(object);
    }
  });
  // Collect first, so hiding a parent cannot disturb traversal or lose the children's original state.
  for (const object of hidden) object.visible = false;
  return () => { for (const object of hidden) object.visible = true; };
}

export function withSolidOverride<T>(renderer: WebGPURenderer, scene: Scene, material: Material, excludeAO: boolean, draw: () => T): T {
  const background = scene.background;
  const backgroundNode = scene.backgroundNode;
  const override = scene.overrideMaterial;
  const renderObject = renderer.getRenderObjectFunction();
  const restoreSides = saveMaterialSides(scene);
  const restoreVisibility = excludeAO ? hideAOExcluded(scene) : () => {};
  try {
    scene.background = null;
    scene.backgroundNode = null;
    scene.overrideMaterial = material;
    renderer.setRenderObjectFunction((object, renderScene, camera, geometry, source, group, lights, clipping, passId) => {
      const overridden = source.allowOverride !== false;
      // The legacy FrontSide solid override never renders the source transmission back-side prepass.
      if (overridden && passId === 'backSide') return;
      // Owned overrides have allowOverride=false. Passing the override here (not the source)
      // prevents common Renderer.renderObject from copying source alpha/transparent/position nodes.
      renderer.renderObject(object, renderScene, camera, geometry, overridden ? material : source, group, lights, clipping, passId);
    });
    return draw();
  } finally {
    restoreVisibility();
    restoreSides();
    scene.background = background;
    scene.backgroundNode = backgroundNode;
    scene.overrideMaterial = override;
    renderer.setRenderObjectFunction(renderObject);
  }
}

export function throwIfPostAborted(signals: readonly (AbortSignal | undefined)[]): void {
  for (const signal of signals) signal?.throwIfAborted();
}

/** Never hold renderer/scene mutations across an await. Late settlements remain handled after cancellation. */
export function abortablePost<T>(work: Promise<T>, signals: readonly (AbortSignal | undefined)[]): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
    const cleanup = () => { for (const signal of active) signal.removeEventListener('abort', onAbort); };
    const onAbort = () => {
      const signal = active.find(candidate => candidate.aborted);
      cleanup();
      reject(signal?.reason ?? new DOMException('Archive post preparation aborted', 'AbortError'));
    };
    for (const signal of active) signal.addEventListener('abort', onAbort, { once: true });
    // Attach both handlers even if already aborted; a late rejected work promise must not be unhandled.
    work.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
    if (active.some(signal => signal.aborted)) onAbort();
  });
}
