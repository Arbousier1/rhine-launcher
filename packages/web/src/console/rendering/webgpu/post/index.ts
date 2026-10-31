import { ColorManagement, NoToneMapping, RenderPipeline, Vector2, WebGPUCoordinateSystem } from 'three/webgpu';
import type { Camera, NodeMaterial, PerspectiveCamera, RenderTarget, Scene, WebGPURenderer } from 'three/webgpu';
import { texture, uv } from 'three/tsl';
import { AO_KERNEL_SIZES, type AOKernelSize } from './kernels';
import { createBokehMaterial, createBlurMaterial, createDepthMaterials, createMultiplyMaterial, createPostUniforms, createSSAOMaterial } from './nodes';
import { PostResources, resizeTarget } from './resources';
import { createOwnedSMAA } from './smaa';
import { abortablePost, saveMaterialSides, throwIfPostAborted, withPostRendererState, withSolidOverride, type PostRendererState } from './state';

export type { AOKernelSize } from './kernels';

/** Structural subset of RenderQuality. Sizes passed to resize are ALREADY physical pixels. */
export interface ArchivePostQuality {
  aoSamples?: number;
  aoResolution?: number;
  depthOfField?: number;
  antialias?: 'off' | 'smaa';
}

export interface ArchivePostSettings {
  aoEnabled: boolean;
  kernelRadius: number;
  minDistance: number;
  maxDistance: number;
  bokehEnabled: boolean;
  focus: number;
  aperture: number;
  maxblur: number;
  smaaEnabled: boolean;
}

export interface ArchivePostPipeline {
  /** Synchronous, after renderer.init(). Renders to the canvas and restores the previous render target. */
  render(): void;
  /** Initializes the renderer, decodes SMAA LUTs, warms all owned pass variants offscreen, waits for its real GPU queue. */
  prepare(signal?: AbortSignal): Promise<void>;
  /** No renderer/camera/CSS resizing here. depthOfField only gates DOF; update.aperture includes the caller's strength. */
  resize(width: number, height: number, quality?: ArchivePostQuality): void;
  update(settings: Partial<ArchivePostSettings>): void;
  /** Idempotent; never disposes the renderer, scene, camera, or any source materials/textures. */
  dispose(): void;
}

const DEFAULT_SETTINGS: ArchivePostSettings = {
  aoEnabled: true, kernelRadius: 0.38, minDistance: 0.001, maxDistance: 0.09,
  bokehEnabled: true, focus: 25, aperture: 0.0018, maxblur: 0.011, smaaEnabled: false,
};

function dimension(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) throw new RangeError('Archive post ' + label + ' must be positive and finite');
  return Math.max(1, Math.floor(value));
}

function validateSettings(settings: ArchivePostSettings): void {
  for (const key of ['aoEnabled', 'bokehEnabled', 'smaaEnabled'] as const) {
    if (typeof settings[key] !== 'boolean') throw new TypeError('Archive post ' + key + ' must be boolean');
  }
  for (const key of ['kernelRadius', 'minDistance', 'maxDistance', 'focus', 'aperture', 'maxblur'] as const) {
    if (!Number.isFinite(settings[key]) || settings[key] < 0) throw new RangeError('Archive post ' + key + ' must be nonnegative and finite');
  }
  if (settings.minDistance > settings.maxDistance) throw new RangeError('Archive post minDistance must not exceed maxDistance');
}

type NativeQueue = { onSubmittedWorkDone(): Promise<void> };

class OwnedArchivePostPipeline implements ArchivePostPipeline {
  private readonly lifetime = new AbortController();
  private disposed = false;
  private drawing = false;
  private preparation: Promise<void> | null = null;
  private width = 1;
  private height = 1;
  private aoResolution = 1;
  private kernelSize: AOKernelSize = 32;
  private sizeRevision = 0;
  private settings = { ...DEFAULT_SETTINGS };
  private readonly uniforms;
  private readonly targets;
  private readonly quad;
  private readonly depthMaterials;
  private readonly normalTexture;
  private readonly hardwareDepth;
  private readonly beautyTexture;
  private readonly bokehDepth;
  private readonly outputTexture;
  private readonly blur;
  private readonly multiply;
  private readonly bokeh;
  private readonly aoMaterials = new Map<AOKernelSize, NodeMaterial>();
  private readonly output;
  private smaa: ReturnType<typeof createOwnedSMAA> | null = null;
  private smaaOutput: RenderPipeline | null = null;
  private readonly outputConfiguration = new WeakMap<RenderPipeline, string>();

  constructor(private readonly renderer: WebGPURenderer, private readonly scene: Scene, private readonly camera: Camera, private readonly owner: PostResources) {
    this.uniforms = createPostUniforms(owner);
    this.targets = {
      beauty: owner.target('ArchivePost.beauty', { depth: true }),
      normal: owner.target('ArchivePost.normal', { depth: true, nearest: true, count: 2, sampledDepth: true }),
      ao: owner.target('ArchivePost.ao'),
      blur: owner.target('ArchivePost.blur'),
      packedDepth: owner.target('ArchivePost.fullPackedDepth', { depth: true, nearest: true }),
      bokeh: owner.target('ArchivePost.bokeh'),
      preparation: owner.target('ArchivePost.preparation'),
    };
    this.targets.normal.textures[1].name = 'ArchivePost.sharedPackedDepth';
    this.quad = owner.quad();
    this.depthMaterials = createDepthMaterials(owner);
    this.normalTexture = owner.own(texture(this.targets.normal.texture, uv()));
    this.hardwareDepth = owner.own(texture(this.targets.normal.depthTexture!, uv()));
    this.beautyTexture = owner.own(texture(this.targets.beauty.texture, uv()));
    this.bokehDepth = owner.own(texture(this.targets.normal.textures[1], uv()));
    this.outputTexture = owner.own(texture(this.targets.bokeh.texture, uv()));
    const aoTexture = owner.own(texture(this.targets.ao.texture, uv()));
    const blurTexture = owner.own(texture(this.targets.blur.texture, uv()));
    this.blur = createBlurMaterial(owner, aoTexture, this.uniforms);
    this.multiply = createMultiplyMaterial(owner, blurTexture);
    this.bokeh = createBokehMaterial(owner, this.beautyTexture, this.bokehDepth, this.uniforms);
    this.output = owner.own(new RenderPipeline(renderer, this.outputTexture));
    // Exactly one transform, in RenderPipeline, after AO -> Bokeh -> optional SMAA.
    this.output.outputColorTransform = true;
    const size = renderer.getDrawingBufferSize(new Vector2());
    this.resize(size.width, size.height);
  }

  private ensureLive(): void {
    if (this.disposed) throw new Error('Archive post pipeline is disposed');
  }

  private validateRenderer(): void {
    this.ensureLive();
    if (!this.renderer.initialized) throw new Error('Archive post requires await renderer.init() or await post.prepare()');
    if (this.renderer.coordinateSystem !== WebGPUCoordinateSystem) throw new Error('Archive post requires the native WebGPU backend, not forceWebGL');
    if (this.renderer.reversedDepthBuffer || this.renderer.logarithmicDepthBuffer) {
      throw new Error('Archive post parity requires ordinary, non-reversed, non-logarithmic depth');
    }
    const camera = this.camera as PerspectiveCamera;
    if (!camera.isPerspectiveCamera || !Number.isFinite(camera.near) || !Number.isFinite(camera.far) || camera.near <= 0 || camera.far <= camera.near) {
      throw new Error('Archive post parity requires a finite PerspectiveCamera with 0 < near < far');
    }
  }

  resize(width: number, height: number, quality: ArchivePostQuality = {}): void {
    this.ensureLive();
    if (this.drawing) throw new Error('Cannot resize archive post during a draw');
    const w = dimension(width, 'width'), h = dimension(height, 'height');
    const scale = quality.aoResolution ?? this.aoResolution;
    if (!Number.isFinite(scale) || scale <= 0 || scale > 1) throw new RangeError('Archive AO resolution must be in (0, 1]');
    const samples = quality.aoSamples;
    if (samples !== undefined && samples !== 0 && !AO_KERNEL_SIZES.includes(samples as AOKernelSize)) {
      throw new RangeError('Archive SSAO supports exactly 0, 16, 32 or 64 samples');
    }
    if (quality.depthOfField !== undefined && (!Number.isFinite(quality.depthOfField) || quality.depthOfField < 0)) {
      throw new RangeError('Archive depthOfField must be nonnegative and finite');
    }
    if (quality.antialias !== undefined && quality.antialias !== 'off' && quality.antialias !== 'smaa') {
      throw new RangeError('Archive post antialias must be off or smaa');
    }
    if (this.width !== w || this.height !== h || this.aoResolution !== scale) this.sizeRevision++;
    this.width = w; this.height = h; this.aoResolution = scale;
    if (samples !== undefined) {
      this.settings.aoEnabled = samples > 0;
      if (samples > 0) this.kernelSize = samples as AOKernelSize;
    }
    if (quality.depthOfField !== undefined) this.settings.bokehEnabled = quality.depthOfField > 0;
    if (quality.antialias !== undefined) this.settings.smaaEnabled = quality.antialias === 'smaa';
    for (const target of [this.targets.beauty, this.targets.bokeh, this.targets.packedDepth, this.targets.preparation]) resizeTarget(target, w, h);
    const aoWidth = Math.max(1, Math.floor(w * scale)), aoHeight = Math.max(1, Math.floor(h * scale));
    for (const target of [this.targets.normal, this.targets.ao, this.targets.blur]) resizeTarget(target, aoWidth, aoHeight);
    this.uniforms.resolution.value.set(aoWidth, aoHeight);
    this.uniforms.aspect.value = w / h;
  }

  update(settings: Partial<ArchivePostSettings>): void {
    this.ensureLive();
    if (this.drawing) throw new Error('Cannot update archive post during a draw');
    const next = { ...this.settings, ...settings };
    validateSettings(next);
    this.settings = next;
    for (const key of ['kernelRadius', 'minDistance', 'maxDistance', 'focus', 'aperture', 'maxblur'] as const) {
      this.uniforms[key].value = next[key];
    }
  }

  private aoMaterial(size: AOKernelSize): NodeMaterial {
    let material = this.aoMaterials.get(size);
    if (!material) {
      material = createSSAOMaterial(this.owner, size, this.normalTexture, this.hardwareDepth, this.uniforms);
      this.aoMaterials.set(size, material);
    }
    return material;
  }

  private getSMAA() {
    if (!this.smaa) {
      this.smaa = createOwnedSMAA(this.owner, this.outputTexture, () => ({ width: this.width, height: this.height }));
      this.smaaOutput = this.owner.own(new RenderPipeline(this.renderer, this.smaa.node));
      this.smaaOutput.outputColorTransform = true;
    }
    return this.smaa;
  }

  private linearState(): void {
    const renderer = this.renderer;
    renderer.setMRT(null);
    renderer.setScissorTest(false);
    renderer.xr.enabled = false;
    renderer.toneMapping = NoToneMapping;
    renderer.outputColorSpace = ColorManagement.workingColorSpace;
    renderer.autoClearColor = renderer.autoClearDepth = renderer.autoClearStencil = true;
  }

  private drawQuad(material: NodeMaterial, target: RenderTarget): void {
    const renderer = this.renderer;
    renderer.setRenderObjectFunction(null);
    renderer.setMRT(null);
    renderer.setRenderTarget(target);
    renderer.autoClear = false;
    this.quad.material = material;
    this.quad.render(renderer);
  }

  private drawBeauty(state: PostRendererState): void {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.targets.beauty);
    renderer.setRenderObjectFunction(state.renderObject);
    renderer.setClearColor(state.clearColor, state.clearAlpha);
    renderer.autoClear = true;
    renderer.render(this.scene, this.camera);
    // The first native scene render may have converted the camera projection from GL to GPU z convention.
    const camera = this.camera as PerspectiveCamera;
    this.uniforms.projection.value.copy(camera.projectionMatrix);
    this.uniforms.inverseProjection.value.copy(camera.projectionMatrixInverse);
    this.uniforms.near.value = camera.near;
    this.uniforms.far.value = camera.far;
  }

  private drawNormalPacked(): void {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.targets.normal);
    renderer.setMRT(null);
    renderer.setClearColor(this.depthMaterials.clearNormal, 1);
    renderer.autoClear = false;
    renderer.clear(true, true, true);
    this.drawQuad(this.depthMaterials.clearMRT, this.targets.normal);
    // Keep autoClear=false after the clear quad: clearing again would make packed background black.
    withSolidOverride(renderer, this.scene, this.depthMaterials.normalPacked, true, () => renderer.render(this.scene, this.camera));
  }

  private drawStandaloneDepth(): void {
    const renderer = this.renderer;
    renderer.setRenderTarget(this.targets.packedDepth);
    renderer.setMRT(null);
    renderer.setClearColor(0xffffff, 1);
    renderer.autoClear = false;
    renderer.clear(true, true, true);
    // Intentional legacy behavior: unlike shared AO depth, BokehPass includes AO-excluded/line/point objects.
    withSolidOverride(renderer, this.scene, this.depthMaterials.packedDepth, false, () => renderer.render(this.scene, this.camera));
  }

  private drawAO(size: AOKernelSize): void {
    this.drawQuad(this.aoMaterial(size), this.targets.ao);
    this.drawQuad(this.blur, this.targets.blur);
    this.drawQuad(this.multiply, this.targets.beauty);
  }

  private drawBokeh(shared: boolean): void {
    if (!shared) this.drawStandaloneDepth();
    this.bokehDepth.value = shared ? this.targets.normal.textures[1] : this.targets.packedDepth.texture;
    this.drawQuad(this.bokeh, this.targets.bokeh);
  }

  private drawOutput(state: PostRendererState, smaaEnabled: boolean, destination: RenderTarget | null): void {
    const renderer = this.renderer;
    const pipeline = smaaEnabled ? (this.getSMAA(), this.smaaOutput!) : this.output;
    const configuration = state.toneMapping + '/' + state.outputColorSpace;
    if (this.outputConfiguration.get(pipeline) !== configuration) {
      pipeline.needsUpdate = true;
      this.outputConfiguration.set(pipeline, configuration);
    }
    renderer.setMRT(null);
    renderer.setRenderObjectFunction(null);
    renderer.setRenderTarget(destination);
    renderer.setClearColor(state.clearColor, state.clearAlpha);
    renderer.setScissorTest(destination === null ? state.scissorTest : false);
    renderer.autoClear = true;
    // RenderPipeline captures these settings, then disables them while rendering its output shader.
    renderer.toneMapping = state.toneMapping;
    renderer.outputColorSpace = state.outputColorSpace;
    pipeline.render();
  }

  private draw(state: PostRendererState, warm: boolean, signals: readonly (AbortSignal | undefined)[]): void {
    this.linearState();
    throwIfPostAborted(signals);
    this.drawBeauty(state);
    throwIfPostAborted(signals);
    if (warm || this.settings.aoEnabled) {
      this.drawNormalPacked();
      if (warm) {
        for (const size of AO_KERNEL_SIZES) {
          throwIfPostAborted(signals);
          // Explicit passes always execute; no PassNode FRAME cache can leave a variant unwarmed.
          this.drawAO(size);
        }
      } else this.drawAO(this.kernelSize);
    }
    throwIfPostAborted(signals);
    if (warm || this.settings.bokehEnabled) {
      const shared = this.settings.aoEnabled && this.targets.normal.width === this.width && this.targets.normal.height === this.height;
      if (warm) {
        // Warm both depth sources; the fallback always remains full resolution.
        this.drawBokeh(true);
        this.drawBokeh(false);
      } else this.drawBokeh(shared);
    }
    this.outputTexture.value = warm || this.settings.bokehEnabled ? this.targets.bokeh.texture : this.targets.beauty.texture;
    throwIfPostAborted(signals);
    if (warm) {
      this.drawOutput(state, false, this.targets.preparation);
      throwIfPostAborted(signals);
      this.drawOutput(state, true, this.targets.preparation);
    } else this.drawOutput(state, this.settings.smaaEnabled, null);
    throwIfPostAborted(signals);
  }

  private guardedDraw(warm: boolean, signals: readonly (AbortSignal | undefined)[]): void {
    this.validateRenderer();
    if (this.drawing) throw new Error('Archive post render is not reentrant');
    this.drawing = true;
    const restoreSides = saveMaterialSides(this.scene);
    const override = this.scene.overrideMaterial;
    const background = this.scene.background;
    const backgroundNode = this.scene.backgroundNode;
    try { withPostRendererState(this.renderer, state => this.draw(state, warm, signals)); }
    finally {
      restoreSides();
      this.scene.overrideMaterial = override;
      this.scene.background = background;
      this.scene.backgroundNode = backgroundNode;
      this.drawing = false;
    }
  }

  render(): void {
    this.ensureLive();
    if (this.settings.smaaEnabled && !this.getSMAA().isReady()) throw new Error('Call await archivePost.prepare() before rendering SMAA');
    this.guardedDraw(false, [this.lifetime.signal]);
  }

  prepare(signal?: AbortSignal): Promise<void> {
    this.ensureLive();
    const signals = [signal, this.lifetime.signal];
    throwIfPostAborted(signals);
    if (this.preparation) return abortablePost(this.preparation, signals);
    const work = (async () => {
      await abortablePost(this.renderer.init(), signals);
      throwIfPostAborted(signals);
      this.validateRenderer();
      await this.getSMAA().prepare(signals);
      throwIfPostAborted(signals);
      const queue = (this.renderer.backend as unknown as { device?: { queue?: NativeQueue } }).device?.queue;
      if (!queue?.onSubmittedWorkDone) throw new Error('Archive post preparation requires the native GPUDevice queue');
      let revision: number;
      do {
        revision = this.sizeRevision;
        this.guardedDraw(true, signals);
        // r183 renderer.waitForGPU is a removed/deprecated no-op, not a synchronization primitive.
        await abortablePost(queue.onSubmittedWorkDone(), signals);
        throwIfPostAborted(signals);
      } while (revision !== this.sizeRevision);
    })();
    this.preparation = work;
    // Keep rejection handling attached without manufacturing an unhandled finally() promise.
    void work.then(() => { if (this.preparation === work) this.preparation = null; }, () => { if (this.preparation === work) this.preparation = null; });
    return work;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort(new DOMException('Archive post pipeline disposed', 'AbortError'));
    this.aoMaterials.clear();
    this.owner.dispose();
  }
}

/** Exact legacy SSAOPass + SharedDepthAO + BokehShader port for Three 0.183.2 native WebGPU.
 * The caller owns renderer initialization/settings, scene node-material conversion, camera, and resize policy.
 * Unsupported reversed/logarithmic/orthographic/forceWebGL modes fail explicitly for the caller's legacy fallback.
 */
export function createArchivePostPipeline(renderer: WebGPURenderer, scene: Scene, camera: Camera): ArchivePostPipeline {
  const owner = new PostResources();
  try { return new OwnedArchivePostPipeline(renderer, scene, camera, owner); }
  catch (error) { try { owner.dispose(); } catch { /* Preserve the construction error after attempting all disposals. */ } throw error; }
}
