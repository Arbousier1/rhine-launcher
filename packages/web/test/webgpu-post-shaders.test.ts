import { describe, expect, it, vi } from 'vitest';
import { ACESFilmicToneMapping, AddEquation, BoxGeometry, CustomBlending, DstAlphaFactor, DstColorFactor, Mesh, NodeMaterial, PerspectiveCamera, QuadMesh, RenderPipeline, Scene, SRGBColorSpace, WebGPUCoordinateSystem, WebGPURenderer, ZeroFactor } from 'three/webgpu';
import type { Node, RenderTarget } from 'three/webgpu';
import { float, texture, uv, vec4 } from 'three/tsl';
import { AO_KERNEL_SIZES } from '../src/console/rendering/webgpu/post/kernels';
import { createBokehMaterial, createBlurMaterial, createDepthMaterials, createMultiplyMaterial, createPostUniforms, createSSAOMaterial, packArchiveDepth, unpackArchiveDepth } from '../src/console/rendering/webgpu/post/nodes';
import { PostResources } from '../src/console/rendering/webgpu/post/resources';
import { createOwnedSMAA } from '../src/console/rendering/webgpu/post/smaa';

/** Use the installed WebGPU backend's real WGSL builder; no browser, GPU, renderer.init(), or application build. */
function shader(material: NodeMaterial, target: RenderTarget, geometry = false) {
  const canvas = { width: 64, height: 32, style: {}, addEventListener() {}, removeEventListener() {} };
  const renderer = new WebGPURenderer({ canvas: canvas as unknown as HTMLCanvasElement });
  // Optional GPU features are absent in this CPU-only fixture; shader generation needs no device.
  renderer.hasFeature = () => false;
  renderer.setRenderTarget(target);
  const object = geometry ? new Mesh(new BoxGeometry(), material) : new QuadMesh(material);
  const camera = new PerspectiveCamera(45, 2, 0.1, 100);
  camera.coordinateSystem = WebGPUCoordinateSystem;
  camera.updateProjectionMatrix();
  const builder = renderer.backend.createNodeBuilder(object, renderer);
  builder.camera = camera;
  builder.scene = new Scene();
  builder.build();
  if (geometry) object.geometry.dispose();
  return { vertex: builder.vertexShader, fragment: builder.fragmentShader };
}

function outputShader(input: Node) {
  const canvas = { width: 64, height: 32, style: {}, addEventListener() {}, removeEventListener() {} };
  const renderer = new WebGPURenderer({ canvas: canvas as unknown as HTMLCanvasElement });
  renderer.hasFeature = () => false;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.outputColorSpace = SRGBColorSpace;
  let code = '';
  renderer.render = (object, camera) => {
    const builder = renderer.backend.createNodeBuilder(object, renderer);
    builder.camera = camera;
    builder.scene = new Scene();
    builder.build();
    code = builder.fragmentShader;
  };
  const pipeline = new RenderPipeline(renderer, input);
  try {
    pipeline.render();
    expect(renderer.toneMapping).toBe(ACESFilmicToneMapping);
    expect(renderer.outputColorSpace).toBe(SRGBColorSpace);
    return code;
  } finally { pipeline.dispose(); }
}

function fixture() {
  const owner = new PostResources();
  const normal = owner.target('normal', { depth: true, count: 2, nearest: true, sampledDepth: true });
  const color = owner.target('color');
  const u = createPostUniforms(owner);
  const normalNode = owner.own(texture(normal.texture, uv()));
  const depthNode = owner.own(texture(normal.depthTexture!, uv()));
  const packed = owner.own(texture(normal.textures[1], uv()));
  const beauty = owner.own(texture(color.texture, uv()));
  return { owner, normal, color, u, normalNode, depthNode, packed, beauty };
}

describe('exact post TSL generates valid native WGSL structure', () => {
  it.each(AO_KERNEL_SIZES)('generates the original %i-sample hemisphere loop with explicit texture LOD', size => {
    const f = fixture();
    try {
      const material = createSSAOMaterial(f.owner, size, f.normalNode, f.depthNode, f.u);
      const code = shader(material, f.color).fragment;
      // Pinned Three optimizes nearest level-0 samples to textureLoad with explicit clamp/repeat wrapping.
      expect(code).toContain('textureLoad');
      expect(code).toContain('tsl_coord_repeatS_repeat_2dT');
      expect(code).toMatch(new RegExp('i < ' + size));
      expect(code).toContain('cross(');
      expect(code).toContain('normalize(');
      expect(code).toContain('!= 1.0');
      expect(code).toContain('mat3x3<f32>');
      expect(code).not.toContain('textureSampleCompare');
      expect(code).not.toMatch(/aces|sRGBTransferOETF/);
    } finally { f.owner.dispose(); }
  });

  it('generates exactly 25 blur samples and 41 Bokeh color samples plus one packed depth sample', () => {
    const f = fixture();
    try {
      const blur = shader(createBlurMaterial(f.owner, f.beauty, f.u), f.color).fragment;
      const bokeh = shader(createBokehMaterial(f.owner, f.beauty, f.packed, f.u), f.color).fragment;
      expect(blur.match(/= textureSampleLevel/g)).toHaveLength(25);
      expect(bokeh.match(/= textureSampleLevel/g)).toHaveLength(41);
      expect(bokeh.match(/= textureLoad/g)).toHaveLength(1);
      expect(blur).toContain('/ 25.0');
      expect(bokeh).toContain('/ vec3<f32>( 41.0 )');
      expect(bokeh).toContain('dot(');
      expect(bokeh).not.toMatch(/aces|sRGBTransferOETF/);
    } finally { f.owner.dispose(); }
  });

  it('writes raw packed normals and interpolated packed depth to separate MRT locations', () => {
    const f = fixture();
    try {
      const materials = createDepthMaterials(f.owner);
      const normal = shader(materials.normalPacked, f.normal, true);
      const clear = shader(materials.clearMRT, f.normal).fragment;
      const depth = shader(materials.packedDepth, f.color, true);
      expect(normal.fragment).toMatch(/@location\(\s*0\s*\)/);
      expect(normal.fragment).toMatch(/@location\(\s*1\s*\)/);
      expect(normal.fragment).toContain('v_clipSpace');
      expect(normal.fragment).toContain('/');
      expect(normal.fragment).toContain('16777216.0');
      expect(normal.fragment).not.toMatch(/sRGBTransferEOTF|sRGBTransferOETF|aces/i);
      expect(clear).toMatch(/m1 = vec4<f32>\( 1.0, 1.0, 1.0, 1.0 \)/);
      expect(depth.fragment).toContain('v_clipSpace');
      expect(materials.clearMRT.depthWrite).toBe(false);
      expect(materials.normalPacked.allowOverride).toBe(false);
    } finally { f.owner.dispose(); }
  });

  it('implements current packing endpoints and byte order rather than the obsolete fract packing', () => {
    const f = fixture();
    try {
      const packed = f.owner.material('pack test', packArchiveDepth(float(0.75)));
      const unpacked = f.owner.material('unpack test', vec4(unpackArchiveDepth(vec4(1))));
      const code = shader(packed, f.color).fragment;
      expect(code).toContain('>= 1.0');
      expect(code).toContain('> 0.0');
      expect(code).toContain('floor(');
      expect(code).toContain('fract(');
      expect(shader(unpacked, f.color).fragment).toContain('dot(');
    } finally { f.owner.dispose(); }
  });

  it('multiplies AO into stored beauty with the original independent RGB/alpha blend factors', () => {
    const f = fixture();
    try {
      const material = createMultiplyMaterial(f.owner, f.beauty);
      expect([material.blending, material.blendSrc, material.blendDst, material.blendEquation]).toEqual([CustomBlending, DstColorFactor, ZeroFactor, AddEquation]);
      expect([material.blendSrcAlpha, material.blendDstAlpha, material.blendEquationAlpha]).toEqual([DstAlphaFactor, ZeroFactor, AddEquation]);
      expect(material.depthTest).toBe(false);
      expect(material.depthWrite).toBe(false);
    } finally { f.owner.dispose(); }
  });

  it('uses the real pinned SMAANode shaders before exactly one ACES/sRGB output transform', () => {
    class ImageFixture { complete = true; naturalWidth = 160; width = 160; height = 560; src = ''; onload = null; onerror = null; }
    vi.stubGlobal('Image', ImageFixture);
    const f = fixture();
    try {
      const smaa = createOwnedSMAA(f.owner, f.beauty, () => ({ width: 64, height: 32 }));
      const internals = smaa.node as any;
      // Building the actual output graph invokes original SMAANode.setup and fills its three stage materials.
      const final = outputShader(smaa.node);
      const plain = outputShader(f.beauty);
      for (const code of [final, plain]) {
        // One function definition and one call; a second transform would add another call.
        expect(code.match(/acesFilmicToneMapping/g)).toHaveLength(2);
        expect(code.match(/sRGBTransferOETF/g)).toHaveLength(2);
      }
      for (const [material, target] of [
        [internals._materialEdges, internals._renderTargetEdges],
        [internals._materialWeights, internals._renderTargetWeights],
        [internals._materialBlend, internals._renderTargetBlend],
      ] as const) {
        const code = shader(material, target).fragment;
        expect(code).toMatch(/textureSample|textureLoad/);
        expect(code).not.toMatch(/acesFilmicToneMapping|sRGBTransferOETF/);
        expect(target.samples).toBe(0);
      }
    } finally { f.owner.dispose(); vi.unstubAllGlobals(); }
  });
});
