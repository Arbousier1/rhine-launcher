import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ACESFilmicToneMapping, BackSide, BoxGeometry, Color, DoubleSide, FrontSide, Group, HalfFloatType, Line, Mesh, MeshBasicMaterial, NearestFilter, NodeMaterial, PerspectiveCamera, Points, RenderPipeline, RenderTarget, Scene, SRGBColorSpace, Texture, Vector2, Vector4, WebGLCoordinateSystem, WebGPUCoordinateSystem } from 'three/webgpu';
import type { Camera, Material, Object3D, WebGPURenderer } from 'three/webgpu';
import { NodeUpdateType, vec4 } from 'three/tsl';
import { createArchivePostPipeline } from '../src/console/rendering/webgpu/post';
import { savePostRendererState } from '../src/console/rendering/webgpu/post/state';

class TestImage extends EventTarget {
  complete = true;
  naturalWidth = 160;
  width = 160;
  height = 560;
  src = '';
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  decode() { return Promise.resolve(); }
}

type Trace = { stage: string; target: RenderTarget | null; autoClear: boolean; visible?: string[]; clear?: number[] };
class RecordingRenderer {
  initialized = true;
  coordinateSystem = WebGPUCoordinateSystem;
  reversedDepthBuffer = false;
  logarithmicDepthBuffer = false;
  toneMapping = ACESFilmicToneMapping;
  toneMappingExposure = 1.2;
  outputColorSpace = SRGBColorSpace;
  xr = { enabled: true };
  autoClear = false;
  autoClearColor = false;
  autoClearDepth = false;
  autoClearStencil = false;
  target: RenderTarget | null = new RenderTarget(7, 9);
  cube = 2;
  mip = 3;
  mrt: unknown = { sentinel: 'mrt' };
  renderObjectHook: any = null;
  color = new Color(0x887766);
  alpha = 0.37;
  viewport = new Vector4(2, 3, 40, 25);
  scissor = new Vector4(4, 5, 30, 20);
  scissorTest = true;
  trace: Trace[] = [];
  drawMaterials: { stage: string; object: Object3D; material: Material; transparent: boolean; alphaTest: number; alphaMap: unknown }[] = [];
  failAt = '';
  onStage?: (stage: string) => void;
  backend = { device: { queue: { onSubmittedWorkDone: vi.fn(() => Promise.resolve()) } } };
  init = vi.fn(async () => { this.initialized = true; return this; });
  getDrawingBufferSize(target: Vector2) { return target.set(64, 32); }
  getRenderTarget() { return this.target; }
  setRenderTarget(target: RenderTarget | null, cube = 0, mip = 0) { this.target = target; this.cube = cube; this.mip = mip; }
  getActiveCubeFace() { return this.cube; }
  getActiveMipmapLevel() { return this.mip; }
  getMRT() { return this.mrt; }
  setMRT(mrt: unknown) { this.mrt = mrt; }
  getRenderObjectFunction() { return this.renderObjectHook; }
  setRenderObjectFunction(hook: unknown) { this.renderObjectHook = hook; }
  getClearColor(target: Color) { return target.copy(this.color); }
  getClearAlpha() { return this.alpha; }
  setClearColor(value: Color | number, alpha = this.alpha) { this.color.set(value); this.alpha = alpha; }
  getViewport(target: Vector4) { return target.copy(this.viewport); }
  setViewport(value: Vector4) { this.viewport.copy(value); }
  getScissor(target: Vector4) { return target.copy(this.scissor); }
  setScissor(value: Vector4) { this.scissor.copy(value); }
  getScissorTest() { return this.scissorTest; }
  setScissorTest(value: boolean) { this.scissorTest = value; }
  clear() { this.trace.push({ stage: 'clear', target: this.target, autoClear: this.autoClear, clear: [...this.color.toArray(), this.alpha] }); }
  render(object: any, camera: Camera) {
    const stage = object.isScene ? (object.overrideMaterial?.name || 'beauty') : object.material.name;
    const visible: string[] = [];
    if (object.isScene) object.traverseVisible((child: any) => { if (child.material) visible.push(child.name); });
    this.trace.push({ stage, target: this.target, autoClear: this.autoClear, visible });
    this.onStage?.(stage);
    if (this.failAt === stage) throw new Error('Injected ' + stage + ' failure');
    if (object.isScene) {
      object.traverseVisible((child: any) => {
        if (!child.material) return;
        const source = Array.isArray(child.material) ? child.material[0] : child.material;
        const draw = (passId: string | null) => {
          if (this.renderObjectHook) this.renderObjectHook(child, object, camera, child.geometry, source, null, null, null, passId);
          else this.renderObject(child, object, camera, child.geometry, source, null, null, null, passId);
        };
        // Deliberately mimic r183's non-exception-safe source double-pass side mutation.
        if (source.transparent && source.side === DoubleSide) {
          source.side = BackSide; draw('backSide'); source.side = FrontSide; draw(null); source.side = DoubleSide;
        } else draw(null);
      });
    }
  }
  renderObject(object: Object3D, scene: Scene, camera: Camera, geometry: any, source: Material, group: any, _lights: any, _clip: any, _pass: any) {
    object.onBeforeRender(this as any, scene, camera, geometry, source, group);
    let material = source;
    if (source.allowOverride && scene.overrideMaterial) {
      material = scene.overrideMaterial;
      material.alphaTest = source.alphaTest;
      (material as any).alphaMap = (source as any).alphaMap;
      material.transparent = source.transparent;
    }
    this.drawMaterials.push({ stage: scene.overrideMaterial?.name || 'beauty', object, material, transparent: material.transparent, alphaTest: material.alphaTest, alphaMap: (material as any).alphaMap });
  }
}

function fixture() {
  const renderer = new RecordingRenderer();
  const scene = new Scene();
  scene.background = new Color(0xabcdef);
  scene.backgroundNode = vec4(0.2, 0.3, 0.4, 1);
  const source = new MeshBasicMaterial({ transparent: true, opacity: 0.2, alphaTest: 0.7, alphaMap: new Texture(), side: DoubleSide });
  const geometry = new BoxGeometry();
  const book = new Mesh(geometry, source); book.name = 'book';
  const excluded = new Mesh(geometry, source); excluded.name = 'excluded'; excluded.userData.excludeFromAO = true;
  const line = new Line(geometry, source); line.name = 'line';
  const point = new Points(geometry, source); point.name = 'point';
  const invisible = new Mesh(geometry, source); invisible.name = 'invisible'; invisible.visible = false;
  const parent = new Group(); parent.userData.excludeFromAO = true;
  const child = new Mesh(geometry, source); child.name = 'excluded-child'; parent.add(child);
  scene.add(book, excluded, line, point, invisible, parent);
  const camera = new PerspectiveCamera(45, 2, 0.1, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem; camera.updateProjectionMatrix();
  const pipeline = createArchivePostPipeline(renderer as unknown as WebGPURenderer, scene, camera);
  return { renderer, scene, source, book, excluded, invisible, parent, child, pipeline, internals: pipeline as any };
}

const originalRender = RenderPipeline.prototype.render;
beforeEach(() => {
  vi.stubGlobal('Image', TestImage);
  // The recording renderer does not have a node manager; invoke the real owned SMAA updater at its normal boundary.
  vi.spyOn(RenderPipeline.prototype, 'render').mockImplementation(function (this: RenderPipeline) {
    if (this.outputNode.constructor.name === 'SMAANode') this.outputNode.updateBefore({ renderer: this.renderer } as any);
    originalRender.call(this);
  });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('archive post pass sequencing and quality', () => {
  it('keeps clear -> solid normal/packed -> hemisphere -> blur25 -> stored beauty multiply -> bokeh41 -> one output', () => {
    const f = fixture();
    const before = savePostRendererState(f.renderer as any);
    try {
      f.pipeline.render();
      expect(f.renderer.trace.map(call => call.stage)).toEqual(['beauty', 'clear', 'ArchivePost.clearNormalPacked', 'ArchivePost.normalPacked', 'ArchivePost.ssao32', 'ArchivePost.blur25', 'ArchivePost.multiplyAO', 'ArchivePost.bokeh41', 'RenderPipeline']);
      const normal = f.renderer.trace.find(call => call.stage === 'ArchivePost.normalPacked')!;
      expect(normal.autoClear).toBe(false);
      expect(normal.visible).toEqual(['book']);
      expect(f.renderer.trace.find(call => call.stage === 'beauty')!.visible).toContain('excluded');
      const multiply = f.renderer.trace.find(call => call.stage === 'ArchivePost.multiplyAO')!;
      expect(multiply.target).toBe(f.internals.targets.beauty);
      expect(f.internals.bokehDepth.value).toBe(f.internals.targets.normal.textures[1]);
      expect(f.renderer.trace.at(-1)!.target).toBeNull();
      expect(f.internals.output.outputColorTransform).toBe(true);
      expect(savePostRendererState(f.renderer as any)).toEqual(before);
      expect(f.excluded.visible).toBe(true); expect(f.invisible.visible).toBe(false); expect(f.parent.visible).toBe(true);
    } finally { f.pipeline.dispose(); }
  });

  it.each([0.5, 0.75])('uses original full-size standalone Bokeh depth at AO scale %s', scale => {
    const f = fixture();
    try {
      f.pipeline.resize(101, 53, { aoSamples: 16, aoResolution: scale });
      f.pipeline.render();
      expect([f.internals.targets.normal.width, f.internals.targets.normal.height]).toEqual([Math.floor(101 * scale), Math.floor(53 * scale)]);
      expect([f.internals.targets.packedDepth.width, f.internals.targets.packedDepth.height]).toEqual([101, 53]);
      expect(f.internals.bokehDepth.value).toBe(f.internals.targets.packedDepth.texture);
      const depth = f.renderer.trace.find(call => call.stage === 'ArchivePost.packedDepth')!;
      expect(depth.visible).toEqual(['book', 'excluded', 'line', 'point', 'excluded-child']);
      const clear = f.renderer.trace.find(call => call.stage === 'clear' && call.target === f.internals.targets.packedDepth)!;
      expect(clear.clear).toEqual([1, 1, 1, 1]);
      expect(f.renderer.trace.map(call => call.stage)).toContain('ArchivePost.ssao16');
    } finally { f.pipeline.dispose(); }
  });

  it('uses full-size depth when AO is off and skips unrequested effects', () => {
    const f = fixture();
    try {
      f.pipeline.resize(80, 40, { aoSamples: 0, depthOfField: 100, antialias: 'off' });
      f.pipeline.render();
      expect(f.renderer.trace.map(call => call.stage)).toEqual(['beauty', 'clear', 'ArchivePost.packedDepth', 'ArchivePost.bokeh41', 'RenderPipeline']);
      f.renderer.trace.length = 0;
      f.pipeline.resize(80, 40, { aoSamples: 0, depthOfField: 0 });
      f.pipeline.render();
      expect(f.renderer.trace.map(call => call.stage)).toEqual(['beauty', 'RenderPipeline']);
      expect(f.internals.outputTexture.value).toBe(f.internals.targets.beauty.texture);
    } finally { f.pipeline.dispose(); }
  });

  it('ignores source alpha/transparent flags in solid passes without changing source materials', () => {
    const f = fixture();
    try {
      f.pipeline.render();
      const draws = f.renderer.drawMaterials.filter(draw => draw.stage === 'ArchivePost.normalPacked');
      expect(draws).toHaveLength(1);
      expect(draws[0].transparent).toBe(false);
      expect(draws[0].alphaTest).toBe(0);
      expect(draws[0].alphaMap).toBeUndefined();
      expect(f.source.transparent).toBe(true); expect(f.source.alphaTest).toBe(0.7); expect(f.source.side).toBe(DoubleSide);
    } finally { f.pipeline.dispose(); }
  });

  it('owns only samples0 HalfFloat post targets; normal and both packed depth inputs stay nearest', () => {
    const f = fixture();
    try {
      for (const target of Object.values(f.internals.targets) as RenderTarget[]) {
        expect(target.samples).toBe(0);
        expect(target.textures.every(t => t.type === HalfFloatType)).toBe(true);
      }
      expect(f.internals.targets.normal.textures).toHaveLength(2);
      for (const target of [f.internals.targets.normal, f.internals.targets.packedDepth]) {
        expect(target.textures.every((t: Texture) => t.minFilter === NearestFilter && t.magFilter === NearestFilter)).toBe(true);
      }
      for (const target of [f.internals.targets.ao, f.internals.targets.blur, f.internals.targets.bokeh]) expect(target.depthBuffer).toBe(false);
      const disposals = Object.values(f.internals.targets).map((target: any) => vi.spyOn(target, 'dispose'));
      f.pipeline.resize(64, 32); f.pipeline.resize(64, 32);
      expect(disposals.every(spy => spy.mock.calls.length === 0)).toBe(true);
    } finally { f.pipeline.dispose(); }
  });

  it('validates unsupported modes and settings instead of silently substituting effects', () => {
    const f = fixture();
    try {
      expect(() => f.pipeline.resize(64, 32, { aoSamples: 24 })).toThrow('0, 16, 32 or 64');
      expect(() => f.pipeline.resize(64, 32, { aoResolution: 0 })).toThrow();
      expect(() => f.pipeline.update({ aperture: NaN })).toThrow();
      f.pipeline.update({ focus: 73, aperture: 0.003, maxblur: 0.009, kernelRadius: 0.44 });
      f.pipeline.resize(64, 32, { depthOfField: 40 });
      expect(f.internals.uniforms.aperture.value).toBe(0.003); // no second strength multiplication
      f.renderer.coordinateSystem = WebGLCoordinateSystem;
      expect(() => f.pipeline.render()).toThrow('native WebGPU');
      f.renderer.coordinateSystem = WebGPUCoordinateSystem;
      f.renderer.reversedDepthBuffer = true;
      expect(() => f.pipeline.render()).toThrow('non-reversed');
    } finally { f.pipeline.dispose(); }
  });
});

describe('archive post failures, cancellation, SMAA and resource ownership', () => {
  it.each(['ArchivePost.clearNormalPacked', 'ArchivePost.normalPacked', 'ArchivePost.ssao32', 'ArchivePost.blur25', 'ArchivePost.multiplyAO', 'ArchivePost.bokeh41', 'RenderPipeline'])('restores all renderer/scene state when %s fails', stage => {
    const f = fixture();
    const before = savePostRendererState(f.renderer as any), background = f.scene.background, backgroundNode = f.scene.backgroundNode;
    const originalOverride = new NodeMaterial(); f.scene.overrideMaterial = originalOverride;
    f.renderer.failAt = stage;
    try {
      expect(() => f.pipeline.render()).toThrow('Injected');
      expect(savePostRendererState(f.renderer as any)).toEqual(before);
      expect(f.scene.overrideMaterial).toBe(originalOverride);
      expect(f.scene.background).toBe(background); expect(f.scene.backgroundNode).toBe(backgroundNode);
      expect(f.excluded.visible).toBe(true); expect(f.invisible.visible).toBe(false); expect(f.parent.visible).toBe(true);
      expect(f.source.side).toBe(DoubleSide);
    } finally { f.pipeline.dispose(); }
  });

  it('restores an override failure inside a source double-sided render callback', () => {
    const f = fixture(); const before = savePostRendererState(f.renderer as any);
    f.book.onBeforeRender = (_renderer, scene) => { if (scene.overrideMaterial?.name === 'ArchivePost.normalPacked') throw new Error('object callback failed'); };
    try {
      expect(() => f.pipeline.render()).toThrow('object callback failed');
      expect(f.source.side).toBe(DoubleSide);
      expect(f.excluded.visible).toBe(true); expect(f.parent.visible).toBe(true);
      expect(savePostRendererState(f.renderer as any)).toEqual(before);
    } finally { f.pipeline.dispose(); }
  });

  it('prepares every owned variant offscreen and uses the real queue rather than the deprecated wait stub', async () => {
    const f = fixture(); const before = savePostRendererState(f.renderer as any);
    try {
      await f.pipeline.prepare();
      const stages = f.renderer.trace.map(call => call.stage);
      for (const name of ['ArchivePost.ssao16', 'ArchivePost.ssao32', 'ArchivePost.ssao64', 'ArchivePost.packedDepth', 'SMAANode.edges', 'SMAANode.weights', 'SMAANode.blend']) expect(stages).toContain(name);
      expect(f.renderer.trace.every(call => call.target !== null)).toBe(true);
      expect(f.renderer.backend.device.queue.onSubmittedWorkDone).toHaveBeenCalledOnce();
      expect(f.internals.smaa.node.updateBeforeType).toBe(NodeUpdateType.RENDER);
      expect(f.internals.smaaOutput.outputColorTransform).toBe(true);
      expect(savePostRendererState(f.renderer as any)).toEqual(before);
      f.pipeline.update({ smaaEnabled: true });
      f.renderer.trace.length = 0;
      f.pipeline.render(); f.pipeline.render();
      expect(f.renderer.trace.filter(call => call.stage === 'SMAANode.edges')).toHaveLength(2);
      expect(f.renderer.trace.filter(call => call.stage === 'RenderPipeline')).toHaveLength(2);
    } finally { f.pipeline.dispose(); }
  });

  it.each(['SMAANode.edges', 'SMAANode.weights', 'SMAANode.blend'])('restores outer and inner state on %s failure', async stage => {
    const f = fixture(); const before = savePostRendererState(f.renderer as any);
    try {
      await f.pipeline.prepare();
      f.pipeline.update({ smaaEnabled: true });
      f.renderer.failAt = stage;
      expect(() => f.pipeline.render()).toThrow('Injected');
      expect(savePostRendererState(f.renderer as any)).toEqual(before);
      expect(f.source.side).toBe(DoubleSide);
    } finally { f.pipeline.dispose(); }
  });

  it('restores state immediately on cancellation during an owned draw', async () => {
    const f = fixture(); const controller = new AbortController(), before = savePostRendererState(f.renderer as any);
    f.renderer.onStage = stage => { if (stage === 'ArchivePost.normalPacked') controller.abort(new Error('cancel post')); };
    try {
      await expect(f.pipeline.prepare(controller.signal)).rejects.toThrow('cancel post');
      expect(savePostRendererState(f.renderer as any)).toEqual(before);
      expect(f.excluded.visible).toBe(true); expect(f.parent.visible).toBe(true);
      expect(f.renderer.backend.device.queue.onSubmittedWorkDone).not.toHaveBeenCalled();
    } finally { f.pipeline.dispose(); }
  });

  it('does not hold renderer mutations while waiting for the GPU and disposal cancels the wait', async () => {
    const f = fixture(); const before = savePostRendererState(f.renderer as any);
    let reached!: () => void, rejectQueue!: (error: Error) => void;
    const entered = new Promise<void>(resolve => { reached = resolve; });
    f.renderer.backend.device.queue.onSubmittedWorkDone.mockImplementation(() => { reached(); return new Promise<void>((_, reject) => { rejectQueue = reject; }); });
    const pending = f.pipeline.prepare();
    await entered;
    expect(savePostRendererState(f.renderer as any)).toEqual(before);
    f.pipeline.dispose();
    await expect(pending).rejects.toThrow('disposed');
    rejectQueue(new Error('late device loss')); // still handled after cancellation
    await Promise.resolve();
    expect(() => f.pipeline.render()).toThrow('disposed');
  });

  it('disposes every owned target, noise texture and SMAA LUT, once, without disposing source resources', async () => {
    const f = fixture();
    await f.pipeline.prepare();
    const targets = Object.values(f.internals.targets) as RenderTarget[];
    const owned = [...f.internals.owner.owned] as any[];
    const disposables = [...targets, ...owned.filter(value => value.isDataTexture)];
    const spies = disposables.map(value => vi.spyOn(value, 'dispose'));
    const sourceDispose = vi.spyOn(f.source, 'dispose'), mapDispose = vi.spyOn(f.source.alphaMap!, 'dispose');
    const smaa = f.internals.smaa.node;
    const areaDispose = vi.spyOn(smaa._areaTexture, 'dispose'), searchDispose = vi.spyOn(smaa._searchTexture, 'dispose');
    f.pipeline.dispose(); f.pipeline.dispose();
    for (const spy of spies) expect(spy).toHaveBeenCalledOnce();
    expect(areaDispose).toHaveBeenCalledOnce(); expect(searchDispose).toHaveBeenCalledOnce();
    expect(smaa._areaTexture.image.onload).toBeNull(); expect(smaa._searchTexture.image.onload).toBeNull();
    expect(sourceDispose).not.toHaveBeenCalled(); expect(mapDispose).not.toHaveBeenCalled();
  });
});
