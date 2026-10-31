import { AddEquation, Color, CustomBlending, DstAlphaFactor, DstColorFactor, Matrix4, Vector2, WebGPUCoordinateSystem, ZeroFactor } from 'three/webgpu';
import type { Node, TextureNode } from 'three/webgpu';
import { Fn, If, Loop, clamp, clipSpace, dot, float, floor, fract, int, mat3, normalView, normalize, outputStruct, texture, uniform, uniformArray, uv, vec2, vec3, vec4 } from 'three/tsl';
import { BOKEH_TAPS, UNPACK_RGBA_FACTORS, createSSAOKernel, createSSAONoise, type AOKernelSize } from './kernels';
import { PostResources } from './resources';

/** Pinned packing.glsl.js r183. Positive modf(x) is fract(x), with floor(x) as its integer output.
 * This is NOT the old fract(depth * vec4(...)) packing (its channel order/edge cases differ).
 */
export const packArchiveDepth = Fn(([depth]: [Node<'float'>]) => {
  const result = vec4(0).toVar();
  If(depth.greaterThanEqual(1), () => {
    result.assign(vec4(1));
  }).ElseIf(depth.greaterThan(0), () => {
    const scaled = depth.mul(16777216).toVar();
    const wholeA = floor(scaled).toVar();
    const af = fract(scaled).toVar();
    const shiftedB = wholeA.mul(1 / 256).toVar();
    const bf = fract(shiftedB).toVar();
    const shiftedG = floor(shiftedB).mul(1 / 256).toVar();
    const gf = fract(shiftedG).toVar();
    result.assign(vec4(floor(shiftedG).mul(1 / 255), gf.mul(256 / 255), bf.mul(256 / 255), af));
  });
  return result;
});

export const unpackArchiveDepth = Fn(([rgba]: [Node<'vec4'>]) => dot(rgba, vec4(...UNPACK_RGBA_FACTORS)));

/** Interpolated clip z/w, not the quantized hardware depth attachment. */
const packedFragmentDepth = Fn((builder) => {
  const z = clipSpace.z.div(clipSpace.w);
  const depth = builder.renderer.coordinateSystem === WebGPUCoordinateSystem ? z : z.mul(0.5).add(0.5);
  return packArchiveDepth(depth);
});

export function createPostUniforms(owner: PostResources) {
  return {
    projection: owner.own(uniform(new Matrix4())),
    inverseProjection: owner.own(uniform(new Matrix4())),
    near: owner.own(uniform(0.1)),
    far: owner.own(uniform(1000)),
    resolution: owner.own(uniform(new Vector2(1, 1))),
    kernelRadius: owner.own(uniform(0.38)),
    minDistance: owner.own(uniform(0.001)),
    maxDistance: owner.own(uniform(0.09)),
    focus: owner.own(uniform(25)),
    aperture: owner.own(uniform(0.0018)),
    maxblur: owner.own(uniform(0.011)),
    aspect: owner.own(uniform(1)),
  };
}
export type PostUniforms = ReturnType<typeof createPostUniforms>;

export function createDepthMaterials(owner: PostResources) {
  const clearNormal = new Color(0x7777ff);
  // MeshNormalNodeMaterial applies an sRGB decode. SSAOPass needs these exact raw packed values.
  const packedNormal = vec4(normalize(normalView).mul(0.5).add(0.5), 1);
  return {
    clearNormal,
    normalPacked: owner.material('ArchivePost.normalPacked', outputStruct(packedNormal, packedFragmentDepth()), true),
    packedDepth: owner.material('ArchivePost.packedDepth', packedFragmentDepth(), true),
    // Native clears attachment>0 to black. A real no-blend draw must set attachment1 to WHITE.
    clearMRT: owner.material('ArchivePost.clearNormalPacked', outputStruct(vec4(clearNormal.r, clearNormal.g, clearNormal.b, 1), vec4(1))),
  };
}

export function createSSAOMaterial(owner: PostResources, size: AOKernelSize, normal: TextureNode, hardwareDepth: TextureNode, u: PostUniforms) {
  // Generate in the same order as SSAOPass: kernel, then SimplexNoise's permutation and 4x4 values.
  const samples = createSSAOKernel(size);
  const noiseTexture = owner.own(createSSAONoise());
  const kernel = owner.own(uniformArray<'vec3'>(samples, 'vec3'));
  const noise = owner.own(texture(noiseTexture, uv()));
  const fragment = Fn(() => {
    // QuadMesh/TextureNode use top-left UVs on WebGPU; legacy FullScreenQuad uses bottom-left UVs.
    const screen = uv();
    const depth = texture(hardwareDepth, screen, 0).r.toVar();
    const result = vec4(1).toVar();
    If(depth.notEqual(1), () => {
      const viewZ = u.near.mul(u.far).div(u.far.sub(u.near).mul(depth).sub(u.far)).toVar();
      const clipW = vec4(u.projection.element(int(2))).w.mul(viewZ).add(vec4(u.projection.element(int(3))).w).toVar();
      // Native clip z is [0,1], not GL's depth*2-1. Flip y ONLY at the NDC boundary.
      const clip = vec4(vec2(screen.x, screen.y.oneMinus()).mul(2).sub(1), depth, 1).mul(clipW);
      const position = u.inverseProjection.mul(clip).xyz.toVar();
      // Do not normalize after unpacking: the legacy pass consumes HalfFloat normal quantization.
      const viewNormal = texture(normal, screen, 0).xyz.mul(2).sub(1).toVar();
      const noiseScale = u.resolution.div(4);
      const random = vec3(texture(noise, vec2(screen.x, screen.y.oneMinus()).mul(noiseScale), 0).r).toVar();
      const tangent = normalize(random.sub(viewNormal.mul(dot(random, viewNormal)))).toVar();
      const bitangent = viewNormal.cross(tangent).toVar();
      const kernelMatrix = mat3(tangent, bitangent, viewNormal);
      const occlusion = float(0).toVar();
      Loop(size, ({ i }) => {
        const sampleVector = kernelMatrix.mul(kernel.element(i));
        const samplePoint = position.add(sampleVector.mul(u.kernelRadius)).toVar();
        const ndc = u.projection.mul(vec4(samplePoint, 1)).toVar();
        ndc.divAssign(ndc.w);
        const projected = ndc.xy.mul(0.5).add(0.5);
        const sampleUV = vec2(projected.x, projected.y.oneMinus());
        // Explicit LOD is required inside divergent WGSL control flow (nearest depth, no mips).
        const realDepth = texture(hardwareDepth, sampleUV, 0).r;
        const realViewZ = u.near.mul(u.far).div(u.far.sub(u.near).mul(realDepth).sub(u.far));
        const linearDepth = realViewZ.add(u.near).div(u.near.sub(u.far));
        const sampleDepth = samplePoint.z.add(u.near).div(u.near.sub(u.far));
        const delta = sampleDepth.sub(linearDepth).toVar();
        If(delta.greaterThan(u.minDistance).and(delta.lessThan(u.maxDistance)), () => {
          occlusion.addAssign(1);
        });
      });
      const visibility = clamp(occlusion.div(size), 0, 1).oneMinus();
      result.assign(vec4(vec3(visibility), 1));
    });
    return result;
  })();
  return owner.material('ArchivePost.ssao' + size, fragment);
}

export function createBlurMaterial(owner: PostResources, ao: TextureNode, u: PostUniforms) {
  return owner.material('ArchivePost.blur25', Fn(() => {
    const result = float(0).toVar();
    // The exact SSAOBlurShader 5x5 box; not bilateral, Gaussian or separable blur.
    for (let i = -2; i <= 2; i++) {
      for (let j = -2; j <= 2; j++) {
        const offset = vec2(i, -j).div(u.resolution);
        result.addAssign(texture(ao, uv().add(offset), 0).r);
      }
    }
    return vec4(vec3(result.div(25)), 1);
  })());
}

export function createMultiplyMaterial(owner: PostResources, blurredAO: TextureNode) {
  const material = owner.material('ArchivePost.multiplyAO', vec4(blurredAO.sample(uv()).rgb, 1));
  material.transparent = true;
  material.blending = CustomBlending;
  material.blendSrc = DstColorFactor;
  material.blendDst = ZeroFactor;
  material.blendEquation = AddEquation;
  material.blendSrcAlpha = DstAlphaFactor;
  material.blendDstAlpha = ZeroFactor;
  material.blendEquationAlpha = AddEquation;
  // Draw into the existing HalfFloat beauty buffer. Bokeh then filters the STORED product.
  return material;
}

export function createBokehMaterial(owner: PostResources, beauty: TextureNode, packedDepth: TextureNode, u: PostUniforms) {
  return owner.material('ArchivePost.bokeh41', Fn(() => {
    const depth = unpackArchiveDepth(texture(packedDepth, uv(), 0)).toVar();
    const viewZ = u.near.mul(u.far).div(u.far.sub(u.near).mul(depth).sub(u.far));
    const factor = u.focus.add(viewZ);
    const blur = vec2(clamp(factor.mul(u.aperture), u.maxblur.negate(), u.maxblur)).toVar();
    const blur9 = blur.mul(0.9).toVar();
    const blur7 = blur.mul(0.7).toVar();
    const blur4 = blur.mul(0.4).toVar();
    // Convert the original GL offsets to native top-left UVs, preserving accumulation order.
    const aspectCorrect = vec2(1, u.aspect.negate());
    const color = vec4(0).toVar();
    for (const [x, y, ring] of BOKEH_TAPS) {
      const radius = ring === 0.9 ? blur9 : ring === 0.7 ? blur7 : ring === 0.4 ? blur4 : blur;
      const sampleUV = x === 0 && y === 0 ? uv() : uv().add(vec2(x, y).mul(aspectCorrect).mul(radius));
      color.addAssign(texture(beauty, sampleUV, 0));
    }
    return vec4(color.rgb.div(41), 1);
  })());
}
