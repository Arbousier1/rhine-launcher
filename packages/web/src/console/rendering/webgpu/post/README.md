# Archive WebGPU postprocessing (Three 0.183.2)

## Public API

The public entry is [index.ts](<packages/web/src/console/rendering/webgpu/post/index.ts>).

```ts
import { createArchivePostPipeline } from './rendering/webgpu/post';

await renderer.init();
const post = createArchivePostPipeline(renderer, scene, camera);
post.resize(physicalWidth, physicalHeight, quality);
post.update({ kernelRadius: 0.44, focus, aperture });
await post.prepare(signal);
post.render();
// Later: post.resize(...), post.update(...), post.render(), post.dispose().
```

- `render(): void` renders to the canvas synchronously, restoring the previously bound target and renderer/scene state. Without SMAA it can be used directly after renderer initialization; call `prepare` before enabling SMAA so its lookup images are decoded.
- `prepare(signal?): Promise<void>` also awaits `renderer.init()`. It decodes the original SMAA lookup images, explicitly renders all three hemisphere kernels and both packed-depth paths offscreen, warms SMAA, and awaits `GPUDevice.queue.onSubmittedWorkDone()`. It does not use deprecated `renderAsync`/`waitForGPU` or frame-cached scene passes. No temporary renderer/scene mutations survive an await.
- `resize(width, height, quality?)` accepts **physical drawing-buffer pixels**, not CSS dimensions. It does not resize the renderer, camera, canvas, or CSS. Repeated identical sizes retain target allocations.
- `update(partialSettings)` changes uniforms/toggles without replacing the pass graph.
- `dispose()` is idempotent, cancels pending preparation, and releases owned targets, attachments, noise/LUT textures, node materials, nodes, and the owned quad geometry. It never disposes the renderer, scene, camera, or source resources.

### Quality fields

| Field | Accepted values | Effect |
| --- | --- | --- |
| `aoSamples` | `0`, `16`, `32`, `64` | Zero disables AO; otherwise selects the original hemisphere kernel and enables AO. Zero retains the last nonzero kernel for later explicit `aoEnabled` updates. |
| `aoResolution` | finite `0 < scale <= 1` | AO dimensions are `max(1, floor(physicalSize * scale))`. Full-resolution Bokeh depth is used whenever dimensions do not match. |
| `depthOfField` | nonnegative finite number | Enables DOF iff positive. **Does not multiply aperture**: the caller retains the original animated, quality-strength-scaled aperture calculation. |
| `antialias` | `off`, `smaa` | Toggles the installed original `SMAANode`. |

Defaults are 32 samples and full-resolution AO. Omitted quality fields retain their previous values. Other `RenderQuality` responsibilities remain with the renderer adapter.

### Update settings

| Setting | Default |
| --- | --- |
| `aoEnabled` | `true` |
| `kernelRadius` | `0.38` |
| `minDistance` | `0.001` |
| `maxDistance` | `0.09` |
| `bokehEnabled` | `true` |
| `focus` | `25` |
| `aperture` | `0.0018` |
| `maxblur` | `0.011` |
| `smaaEnabled` | `false` |

Numeric settings must be finite and nonnegative; `minDistance <= maxDistance`. The refined lighting adapter should set radius `0.44`. Camera near/far and projection matrices update each render.

## Preserved algorithm and ordering

1. Linear HalfFloat beauty, `samples: 0`.
2. A separate solid normal + packed-depth MRT override (`count: 2`, HalfFloat, nearest) and sampled hardware depth. A no-blend clear quad writes packed background `(1,1,1,1)` because native attachment clears above zero are black. Scene rendering then uses `autoClear = false`.
3. Original randomized 16/32/64 hemisphere kernel, repeated 4x4 nearest red Float noise, original radius and strict minimum/maximum depth-delta bounds. Background AO is one. Native clip Z and top-left UV conversions are explicit.
4. Exact 25-tap box blur, then the original destination-color/destination-alpha blend **into the HalfFloat beauty target**. Bokeh samples the stored product, not separately filtered beauty and AO.
5. Exact BokehShader 41 literal taps, accumulation order, signed CoC clamp, perspective packed-depth decode, aspect correction, and output alpha one.
6. Optional original SMAANode, using its own three shaders and lookup textures. Its updater runs per render rather than once per RAF, is exception-safe, and uses the requested physical dimensions.
7. Exactly one RenderPipeline output transform. The caller configures renderer tone mapping/exposure/output color space (normally ACES + sRGB); no AO/DOF/SMAA stage applies another transform.

Solid geometry overrides bypass common-renderer inheritance of source alpha maps, transparency, and position nodes, matching the original override material. Source render-list ordering and callbacks are retained. Source double-sided transmission prepasses are skipped for the FrontSide override.

The AO/shared-depth path hides `excludeFromAO`, lines, Line2 and points and restores their original visibility even on errors. **The standalone full-size Bokeh-depth path includes those objects**, exactly as the original BokehPass fallback does. This distinction is intentional.

## Boundaries and verification

- Native WebGPU only; forceWebGL, reversed depth, logarithmic depth, non-perspective cameras and invalid near/far planes fail explicitly for the adapter to use legacy fallback. XR is not an archive postprocessing mode.
- Requires the caller to supply WebGPU-compatible scene materials and handle initialization failure, device loss, and fallback. No scene/material/backend integration occurs here.
- SMAA lifecycle access is deliberately pinned to the installed 0.183.2 internals for image readiness, owned stage execution and cleanup; shader setup itself is unchanged.
- Preparation warms owned passes offscreen. It is not certification of the GPU driver, every scene/shadow/material variant, or the final canvas-format pipeline; the integrating adapter owns those checks.
- Shader/filter math matches the pinned legacy implementations. Different random streams and GPU depth/float precision do not promise bit-identical GL/native screenshots.

Scoped tests compare kernels/noise/taps against the installed legacy implementations, generate actual native WGSL without GPU initialization, verify SMAA plus exactly one ACES/sRGB output, and exercise pass order, quality, every stage failure, cancellation and disposal. Browser rendering and full integration verification are intentionally left to Lead.
