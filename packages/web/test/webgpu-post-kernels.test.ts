import { describe, expect, it, vi } from 'vitest';
import { PerspectiveCamera, Scene } from 'three/webgpu';
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
import { BokehShader } from 'three/addons/shaders/BokehShader.js';
import { AO_KERNEL_SIZES, BOKEH_TAPS, UNPACK_RGBA_FACTORS, createSSAOKernel, createSSAONoise } from '../src/console/rendering/webgpu/post/kernels';

function seeded(seed: number) {
  let state = seed >>> 0;
  return () => ((state = (Math.imul(state, 1664525) + 1013904223) >>> 0) / 4294967296);
}

describe('pinned SSAOPass hemisphere and red-noise parity', () => {
  it.each(AO_KERNEL_SIZES)('reproduces all original %i samples and noise values with the same random stream', size => {
    const scene = new Scene(), camera = new PerspectiveCamera();
    const spy = vi.spyOn(Math, 'random').mockImplementation(seeded(1783));
    const original = new SSAOPass(scene, camera, 4, 4, size);
    spy.mockRestore();
    const random = seeded(1783);
    const kernel = createSSAOKernel(size, random);
    const noise = createSSAONoise(random);
    try {
      expect(kernel.map(sample => sample.toArray())).toEqual(original.kernel.map(sample => sample.toArray()));
      expect(Array.from(noise.image.data as Float32Array)).toEqual(Array.from(original.noiseTexture.image.data));
      expect(noise.format).toBe(original.noiseTexture.format);
      expect(noise.type).toBe(original.noiseTexture.type);
      expect(noise.wrapS).toBe(original.noiseTexture.wrapS);
      expect(noise.wrapT).toBe(original.noiseTexture.wrapT);
      expect(noise.minFilter).toBe(original.noiseTexture.minFilter);
      expect(noise.magFilter).toBe(original.noiseTexture.magFilter);
      expect([noise.image.width, noise.image.height]).toEqual([4, 4]);
      for (let i = 0; i < size; i++) {
        expect(kernel[i].z).toBeGreaterThanOrEqual(0);
        expect(kernel[i].length()).toBeCloseTo(0.1 + 0.9 * (i / size) ** 2, 14);
      }
    } finally {
      noise.dispose();
      original.dispose();
      // SSAOPass r183 itself omits these two resources in dispose(). Our owned port does not.
      original.noiseTexture.dispose();
      original.ssaoMaterial.dispose();
    }
  });
});

describe('pinned BokehShader 41-tap filter', () => {
  it('keeps every original offset, radius and accumulation position, not a reconstructed disk', () => {
    const taps = BokehShader.fragmentShader.split('\n').filter(line => line.includes('col += texture2D')).map(line => {
      const offset = line.match(/vec2\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/);
      if (!offset) return [0, 0, 1];
      const ring = line.includes('dofblur9') ? 0.9 : line.includes('dofblur7') ? 0.7 : line.includes('dofblur4') ? 0.4 : 1;
      return [Number(offset[1]), Number(offset[2]), ring];
    });
    expect(BOKEH_TAPS).toHaveLength(41);
    expect(BOKEH_TAPS).toEqual(taps);
    expect([1, 0.9, 0.7, 0.4].map(r => BOKEH_TAPS.filter(tap => tap[2] === r).length)).toEqual([17, 8, 8, 8]);
  });

  it('decodes white packed background to precisely far depth', () => {
    expect(UNPACK_RGBA_FACTORS.reduce((sum, value) => sum + value, 0)).toBe(1);
    expect(UNPACK_RGBA_FACTORS).toEqual([255 / 256, 255 / 65536, 255 / 16777216, 1 / 16777216]);
  });
});
