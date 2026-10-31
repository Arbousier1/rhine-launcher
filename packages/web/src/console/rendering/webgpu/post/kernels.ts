import { DataTexture, FloatType, MathUtils, NearestFilter, RedFormat, RepeatWrapping, Vector3 } from 'three/webgpu';
import { SimplexNoise } from 'three/addons/math/SimplexNoise.js';

export const AO_KERNEL_SIZES = [16, 32, 64] as const;
export type AOKernelSize = typeof AO_KERNEL_SIZES[number];

/** SSAOPass r183: a hemisphere, NOT a sphere, Vogel disk or GTAO kernel. */
export function createSSAOKernel(size: AOKernelSize, random: () => number = Math.random): Vector3[] {
  const kernel: Vector3[] = [];
  for (let i = 0; i < size; i++) {
    const sample = new Vector3(random() * 2 - 1, random() * 2 - 1, random());
    sample.normalize();
    const scale = i / size;
    sample.multiplyScalar(MathUtils.lerp(0.1, 1, scale * scale));
    kernel.push(sample);
  }
  return kernel;
}

/** The original 4x4, nearest, repeated, single-red-channel float noise. */
export function createSSAONoise(random: () => number = Math.random): DataTexture {
  const simplex = new SimplexNoise({ random });
  const data = new Float32Array(16);
  for (let i = 0; i < data.length; i++) {
    data[i] = simplex.noise3d(random() * 2 - 1, random() * 2 - 1, 0);
  }
  const noise = new DataTexture(data, 4, 4, RedFormat, FloatType);
  noise.name = 'ArchivePost.ssaoNoise';
  noise.minFilter = noise.magFilter = NearestFilter;
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.generateMipmaps = false;
  noise.needsUpdate = true;
  return noise;
}

/** BokehShader r183, in accumulation order. Each tuple is x, y, ring scale.
 * Keep the literal offsets: approximating these with sin/cos is not the same filter.
 */
export const BOKEH_TAPS = [
  [0, 0, 1],
  [0, 0.4, 1], [0.15, 0.37, 1], [0.29, 0.29, 1], [-0.37, 0.15, 1],
  [0.4, 0, 1], [0.37, -0.15, 1], [0.29, -0.29, 1], [-0.15, -0.37, 1],
  [0, -0.4, 1], [-0.15, 0.37, 1], [-0.29, 0.29, 1], [0.37, 0.15, 1],
  [-0.4, 0, 1], [-0.37, -0.15, 1], [-0.29, -0.29, 1], [0.15, -0.37, 1],
  [0.15, 0.37, 0.9], [-0.37, 0.15, 0.9], [0.37, -0.15, 0.9], [-0.15, -0.37, 0.9],
  [-0.15, 0.37, 0.9], [0.37, 0.15, 0.9], [-0.37, -0.15, 0.9], [0.15, -0.37, 0.9],
  [0.29, 0.29, 0.7], [0.4, 0, 0.7], [0.29, -0.29, 0.7], [0, -0.4, 0.7],
  [-0.29, 0.29, 0.7], [-0.4, 0, 0.7], [-0.29, -0.29, 0.7], [0, 0.4, 0.7],
  [0.29, 0.29, 0.4], [0.4, 0, 0.4], [0.29, -0.29, 0.4], [0, -0.4, 0.4],
  [-0.29, 0.29, 0.4], [-0.4, 0, 0.4], [-0.29, -0.29, 0.4], [0, 0.4, 0.4],
] as const;

export const UNPACK_RGBA_FACTORS = [255 / 256, 255 / 65536, 255 / 16777216, 1 / 16777216] as const;
