import { afterEach, describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial, PhysicalLightingModel } from "three/webgpu";
import type { Node, NodeBuilder } from "three/webgpu";
import {
  DFGLUT, attenuationColor, attenuationDistance, cameraPosition, cameraProjectionMatrix, cameraViewMatrix,
  diffuseColor, dispersion, float, getCurrentStack, int, ior, mat4, metalness, mix, modelViewMatrix,
  modelWorldMatrix, normalView, normalWorld, positionGeometry, positionLocal, positionView, positionWorld,
  reference, roughness, screenSize, setCurrentStack, specularColor, specularF90, stack,
  textureBicubicLevel, thickness, transmission, vec2, vec3, vec4, viewportOpaqueMipTexture,
} from "three/tsl";
import {
  ArchiveBasicNodeMaterial, ArchivePhysicalNodeMaterial, createArchiveNodeMaterial,
  getArchiveNodeControls,
} from "../src/console/rendering/webgpu/materials/index.ts";
import type { ArchiveNodeControls } from "../src/console/rendering/webgpu/materials/index.ts";
import {
  archiveCoverageNode, archiveDarkSurfaceNode, archiveFrostTintNode, archiveHeightNode,
  archiveInternalAlphaNode, archivePrintedThemeNode, archiveProjectedAxisNode,
  archiveRevealNode, archiveRoughnessNode, archiveTransmissionLodNode, createArchiveSurfaceNodes,
} from "../src/console/rendering/webgpu/materials/surface-nodes.ts";
import { completeArchiveControls } from "../src/console/rendering/webgpu/materials/controls.ts";
import { ArchiveFrostedLightingModel, archiveIBLVolumeRefraction, archiveVolumeAttenuation, archiveVolumeTransmissionRay } from "../src/console/rendering/webgpu/materials/frosted-lighting.ts";
import { frostedTransmissionLod, glassRevealAtHeight } from "../src/console/glass-reveal.ts";
import { configureInternalOptics } from "../src/console/internal-optics.ts";
import { themeMaterial } from "../src/console/theme-material.ts";
import { CardAppearance } from "../src/console/appearance.ts";

// Evaluate the REAL TSL arithmetic graph, not a second production CPU formula.
// No browser, GPU, shader compiler, render target, server or application build is used.
type Value = number | boolean | number[] | number[][];
type Graph = Record<string, any>;
type Bindings = Map<string, Value>;
const graph = (node: unknown) => node as Graph;
const binding = (...entries: [Node, Value][]): Bindings => new Map(entries.map(([node, value]) => [node.uuid, value]));
const channels = (v: Value): number[] => (Array.isArray(v) ? v : [Number(v)]) as number[];
function componentwise(fn: (...values: number[]) => number, ...values: Value[]): Value {
  const arrays = values.map(channels);
  const count = Math.max(...arrays.map(a => a.length));
  const result = Array.from({ length: count }, (_, i) => fn(...arrays.map(a => a.length === 1 ? a[0] : a[i])));
  return values.some(Array.isArray) ? result : result[0];
}
const clamp = (v: number) => Math.max(0, Math.min(1, v));
const smoothstep = (a: number, b: number, v: number) => { const t = clamp((v - a) / (b - a)); return t * t * (3 - 2 * t); };
const lerp = (a: number, b: number, t: number) => a * (1 - t) + b * t;
const swizzle = (name: string) => [...name].map(c => ({ x: 0, r: 0, y: 1, g: 1, z: 2, b: 2, w: 3, a: 3 })[c]!);

function evaluate(input: unknown, values: Bindings = new Map(), material?: THREE.Material): Value {
  if (typeof input === "number" || typeof input === "boolean") return input;
  const n = graph(input);
  if (values.has(n.uuid)) return values.get(n.uuid)!;
  if (n.constructor.name === "ShaderNodeInternal") return evaluate(n.call(), values, material);
  if (n.isShaderCallNodeInternal) {
    if (values.has(n.shaderNode.uuid)) return values.get(n.shaderNode.uuid)!;
    const expanded = expandShader(n);
    const conditional = expanded.nodes.find(child => child.constructor.name === "ConditionalNode");
    if (conditional && evaluate(conditional.condNode, values, material)) return evaluate(conditional.ifNode, values, material);
    runAssignments(expanded.nodes.filter(child => child.constructor.name !== "ConditionalNode"), values);
    return evaluate(expanded.result, values, material);
  }
  if (n.isMaterialReferenceNode) return graph(n.material ?? material)[n.property];
  if (n.object && n.property) return n.object[n.property];
  if (n.isConstNode || n.isUniformNode) {
    if (n.value?.isMatrix4) return Array.from({ length: 4 }, (_, i) => n.value.elements.slice(i * 4, i * 4 + 4));
    return n.value?.toArray ? n.value.toArray() : n.value;
  }
  if (n.isSplitNode) {
    const source = channels(evaluate(n.node, values, material));
    const result = swizzle(n.components).map(i => source[i]);
    return result.length === 1 ? result[0] : result;
  }
  if (n.isArrayElementNode) return (evaluate(n.node, values, material) as number[][])[Number(evaluate(n.indexNode, values, material))];
  if (n.constructor.name === "JoinNode") return n.nodes.flatMap((child: unknown) => channels(evaluate(child, values, material)));
  if (n.constructor.name === "ConvertNode") {
    const source = evaluate(n.node, values, material);
    if (n.convertTo === "float" || n.convertTo === "int") return channels(source)[0];
    const count = Number(n.convertTo?.slice(-1));
    if (count >= 2 && count <= 4) {
      const a = channels(source);
      return a.length === 1 ? Array(count).fill(a[0]) : Array.from({ length: count }, (_, i) => a[i] ?? (i === 3 ? 1 : 0));
    }
    return source;
  }
  if (n.isVarNode || n.isVaryingNode || n.isSubBuildNode) return evaluate(n.node, values, material);
  if (n.isOperatorNode) {
    const a = evaluate(n.aNode, values, material), b = evaluate(n.bNode, values, material);
    if (n.op === "!=") return Number(a) !== Number(b);
    if (n.op === "*" && Array.isArray(a) && Array.isArray(a[0])) {
      const matrix = a as number[][], vector = channels(b);
      return matrix[0].map((_, row) => matrix.reduce((sum, column, index) => sum + column[row] * vector[index], 0));
    }
    if (n.op === ">") return Number(a) > Number(b);
    if (n.op === "<=") return Number(a) <= Number(b);
    const op = ({ "+": (x: number, y: number) => x + y, "-": (x: number, y: number) => x - y,
      "*": (x: number, y: number) => x * y, "/": (x: number, y: number) => x / y })[n.op as "+" | "-" | "*" | "/"];
    if (!op) throw new Error("Unimplemented operator " + n.op);
    return componentwise(op, a, b);
  }
  if (n.isMathNode) {
    const a = evaluate(n.aNode, values, material);
    const b = n.bNode ? evaluate(n.bNode, values, material) : 0;
    const c = n.cNode ? evaluate(n.cNode, values, material) : 0;
    switch (n.method) {
      case "smoothstep": return componentwise(smoothstep, a, b, c);
      case "mix": return componentwise(lerp, a, b, c);
      case "clamp": return componentwise((x, lo, hi) => Math.max(lo, Math.min(hi, x)), a, b, c);
      case "max": return componentwise(Math.max, a, b);
      case "min": return componentwise(Math.min, a, b);
      case "pow": return componentwise(Math.pow, a, b);
      case "fract": return componentwise(x => x - Math.floor(x), a);
      case "abs": return componentwise(Math.abs, a);
      case "negate": return componentwise(x => -x, a);
      case "oneMinus": return componentwise(x => 1 - x, a);
      case "log": return componentwise(Math.log, a);
      case "exp": return componentwise(Math.exp, a);
      case "log2": return componentwise(Math.log2, a);
      case "exp2": return componentwise(x => 2 ** x, a);
      case "length": return Math.hypot(...channels(a));
      case "normalize": { const length = Math.hypot(...channels(a)); return channels(a).map(v => v / length); }
      case "dot": return channels(a).reduce((sum, v, i) => sum + v * channels(b)[i], 0);
      case "refract": {
        const incident = channels(a), normal = channels(b), eta = Number(c);
        const dot = incident.reduce((sum, v, i) => sum + v * normal[i], 0);
        const k = 1 - eta * eta * (1 - dot * dot);
        return incident.map((v, i) => k < 0 ? 0 : eta * v - (eta * dot + Math.sqrt(k)) * normal[i]);
      }
      default: throw new Error("Unimplemented math " + n.method);
    }
  }
  throw new Error("Missing graph binding/evaluator for " + n.constructor.name + ":" + n.name);
}

function walk(input: unknown, visited = new Set<unknown>()): Graph[] {
  if (!input || typeof input !== "object" || visited.has(input)) return [];
  visited.add(input);
  const n = graph(input);
  const result = n.isNode ? [n] : [];
  for (const key of ["node", "aNode", "bNode", "cNode", "sourceNode", "targetNode", "indexNode", "nodes", "rawInputs", "uvNode"]) {
    const value = n[key];
    if (Array.isArray(value)) for (const child of value) result.push(...walk(child, visited));
    else result.push(...walk(value, visited));
  }
  return result;
}

function withStack<T>(run: () => T) {
  const previous = getCurrentStack();
  const current = stack();
  setCurrentStack(current);
  try { return { result: run(), nodes: graph(current).nodes as Graph[] }; }
  finally { setCurrentStack(previous); }
}

function shaderCall(input: unknown): Graph {
  const call = walk(input).find(n => n.isShaderCallNodeInternal);
  if (!call) throw new Error("Expected an actual TSL Fn call");
  return call;
}
function expandShader(input: unknown) {
  const call = shaderCall(input), raw = call.rawInputs;
  const parameters = raw?.length === 1 && !raw[0].isNode ? raw[0] : raw;
  return withStack(() => call.shaderNode.jsFunc(parameters));
}

function setTarget(input: Graph, value: Value, values: Bindings) {
  if (input.constructor.name === "ConvertNode") return setTarget(input.node, value, values);
  if (input.isArrayElementNode) {
    const parent = channels(evaluate(input.node, values)).slice();
    parent[Number(evaluate(input.indexNode, values))] = Number(value);
    return setTarget(input.node, parent, values);
  }
  if (input.isSplitNode) {
    const parent = channels(evaluate(input.node, values)).slice();
    swizzle(input.components).forEach((index, i) => { parent[index] = channels(value)[i]; });
    return setTarget(input.node, parent, values);
  }
  values.set(input.uuid, value);
}
function runAssignments(nodes: Graph[], values: Bindings) {
  for (const n of nodes) {
    if (n.constructor.name === "LoopNode") {
      const { start, end } = n.params[0];
      for (let i = start; i < end; i++) {
        const body = expandShader(n.params.at(-1)({ i: int(i) }));
        runAssignments(body.nodes, values);
      }
    } else if (n.isAssignNode) setTarget(n.targetNode, evaluate(n.sourceNode, values), values);
    else if (n.isVarNode) values.set(n.uuid, evaluate(n, values));
  }
}
function expectVector(actual: Value, expected: number[]) {
  expect(channels(actual)).toHaveLength(expected.length);
  channels(actual).forEach((v, i) => expect(v).toBeCloseTo(expected[i], 12));
}
const options = (extra: Partial<ArchiveNodeControls> = {}): ArchiveNodeControls => ({
  surface: "Frosted_Polymer", instanced: false, hasLow: true,
  quality: { value: 0.7 }, clarity: { value: 0.4 }, theme: { value: 0.2 }, subdued: { value: 0.3 }, ...extra,
});
afterEach(() => vi.restoreAllMocks());

describe("WebGPU archive exact TSL formulas", () => {
  it("uses untransformed geometry height and the actual projected model-view Y axis", () => {
    const height = archiveHeightNode(), axis = archiveProjectedAxisNode();
    const projection = [[4, 0, 0, 0], [0, 5, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
    const modelView = [[0.8, 0.6, 0, 0], [-0.6, 0.8, 0, 0], [0, 0, 1, 0], [9, 7, -10, 1]];
    const values = binding([positionGeometry, [1, 1.85, 2]], [positionLocal, [3, 900, 4]],
      [cameraProjectionMatrix, projection], [modelViewMatrix, modelView], [positionView, [9, 7, -13.9]]);
    expect(evaluate(height, values)).toBe(0.5);
    expectVector(evaluate(axis, values), [1.85 * 4 * -0.6 / 13.9, 1.85 * 5 * 0.8 / 13.9]);
    values.set(positionView.uuid, [9, 7, 0]);
    expectVector(evaluate(axis, values), [1.85 * 4 * -0.6 / 0.0001, 1.85 * 5 * 0.8 / 0.0001]);
    expect(walk(height).some(n => n.uuid === positionLocal.uuid)).toBe(false);
    expect(graph(height).isVaryingNode).toBe(true);
    expect(graph(axis).isVaryingNode).toBe(true);
  });

  it("matches the legacy clearing feather, clamps, endpoints and moving front", () => {
    for (const c of [-1, 0, 0.03, 0.25, 0.5, 0.9, 1, 2]) for (const h of [-2, 0, 0.05, 0.4, 0.6, 0.98, 1, 3]) {
      expect(evaluate(archiveRevealNode(float(c), float(h)))).toBeCloseTo(glassRevealAtHeight(c, h), 13);
    }
    expect(evaluate(archiveRevealNode(float(0.5), float(0.8)))).toBe(1);
    expect(evaluate(archiveRevealNode(float(0.5), float(0.2)))).toBe(0);
  });

  it("matches the warm frost RGB and raw roughness without clamping quality", () => {
    for (const q of [0, 0.3, 0.7, 1, 1.2]) for (const h of [-1, 0.1, 0.45, 1, 2]) {
      const gradient = smoothstep(0.1, 1, h);
      const tint = [0.4, 0.3, 0.2].map((v, i) => lerp(lerp(v, [1, 0.98, 0.94][i], gradient), 1, q));
      expectVector(evaluate(archiveFrostTintNode(float(h), float(q))), tint);
      for (const clarity of [0, 0.5, 1]) {
        const reveal = glassRevealAtHeight(clarity, h);
        expect(evaluate(archiveRoughnessNode(float(q), float(reveal)))).toBeCloseTo(lerp(lerp(0.28, 0.42, q), 0.025, reveal), 14);
      }
    }
  });

  it("matches legacy bounded bicubic LOD for final physical roughness and rectangular buffers", () => {
    const r = { value: 0 }, eta = { value: 1.46 }, q = { value: 1 };
    const size = vec2(32, 64), axis = vec2(0.17, 0.23);
    const lod = archiveTransmissionLodNode(reference("value", "float", r), reference("value", "float", eta), size, axis, reference("value", "float", q));
    for (const [width, height] of [[512, 512], [1920, 1080], [960, 1920], [3840, 2160]]) {
      for (const projected of [[0.002, 0.001], [-0.2, 0.25], [0, 0.9]]) {
        const values = binding([size, [width, height]], [axis, projected]);
        for (r.value of [0, 0.025, 0.0525, 0.28, 0.42, 0.72, 1]) for (eta.value of [1, 1.1, 1.46, 1.5, 2.2]) for (q.value of [0, 0.25, 0.7, 1]) {
          const expected = frostedTransmissionLod(Math.hypot(projected[0] * width, projected[1] * height), width, r.value, q.value, eta.value);
          expect(evaluate(lod, values)).toBeCloseTo(expected, 12);
        }
      }
    }
  });

  it("matches gl_FragCoord IGN, including top-left to bottom-left conversion and the strict mask", () => {
    const q = { value: 0.5 };
    const material = new ArchivePhysicalNodeMaterial(new THREE.MeshPhysicalMaterial(), options({ surface: "Internal_Ceramic", hasLow: false, quality: q }));
    const nodes = walk(material.maskNode);
    const coordinate = nodes.find(n => n.scope === "coordinate")!;
    const size = nodes.find(n => n.scope === "size")!;
    for (const [x, y, height] of [[0.5, 0.5, 1080], [28.5, 1067.5, 1080], [443.5, 872.5, 1920]]) {
      const frac = (v: number) => v - Math.floor(v);
      const expected = frac(52.9829189 * frac(x * 0.06711056 + (height - y) * 0.00583715));
      expect(evaluate(archiveCoverageNode(vec2(x, y), vec2(1920, height)))).toBeCloseTo(expected, 13);
      const values = new Map([[coordinate.uuid, [x, y]], [size.uuid, [1920, height]]]) as Bindings;
      q.value = expected;
      expect(evaluate(material.maskNode, values)).toBe(false);
      q.value = expected + 0.000001;
      expect(evaluate(material.maskNode, values)).toBe(true);
      q.value = 0;
      expect(evaluate(material.maskNode, values)).toBe(false);
      q.value = 1;
      expect(evaluate(material.maskNode, values)).toBe(true);
    }
  });

  it("uses the legacy sRGB palette, reveal whites, subdued ink and per-instance theme varying", () => {
    for (const name of ["Frosted_Polymer", "Ivory_Edges", "Optical_Diffuser", "Titanium_Fasteners", "Index_Inlay", "Printed_Label", "Subsurface_Optics", "Optical_Edges", "Carbon_Ink", "Orange_Rib", "Unknown_Surface"]) {
      const legacy = new THREE.MeshPhysicalMaterial();
      themeMaterial(legacy, name);
      const shader = { uniforms: {}, vertexShader: "", fragmentShader: "#include <roughnessmap_fragment>" };
      legacy.onBeforeCompile(shader as never, {} as THREE.WebGLRenderer);
      const dark = (shader.uniforms as Record<string, { value: THREE.Color }>).rhineDarkSurface.value.toArray();
      expectVector(evaluate(archiveDarkSurfaceNode(name, false, float(0), float(0))), dark);
      if (name === "Index_Inlay") expectVector(evaluate(archiveDarkSurfaceNode(name, false, float(0), float(0.6))), dark.map((v, i) => lerp(v, [0.030, 0.042, 0.048][i], 0.6)));
    }
    expectVector(evaluate(archiveDarkSurfaceNode("Frosted_Polymer", false, float(1), float(0))), [0.92, 0.96, 0.97]);
    expectVector(evaluate(archiveDarkSurfaceNode("Frosted_Polymer", true, float(1), float(0))), new THREE.Color("#626b70").toArray());
    const nodes = createArchiveSurfaceNodes(completeArchiveControls(options({ instanced: true })));
    expect(graph(nodes.theme).isVaryingNode).toBe(true);
    expect(walk(nodes.theme).some(n => n.getAttributeName?.() === "archiveTheme")).toBe(true);
  });

  it("maps printed luminance with the exact thresholds from diffuse, not outgoing light", () => {
    const outgoing = [0.85, 0.32, 1.1];
    for (const gray of [0, 0.119, 0.12, 0.37, 0.65, 0.9, 1]) for (const theme of [0, 0.4, 1]) {
      const ink = 1 - smoothstep(0.12, 0.65, gray);
      const dark = [0.023, 0.032, 0.037].map((v, i) => lerp(v, [0.78, 0.78, 0.71][i], ink));
      expectVector(evaluate(archivePrintedThemeNode(vec3(...outgoing as [number, number, number]), vec3(gray), float(theme))), outgoing.map((v, i) => lerp(v, dark[i], theme)));
    }
  });

  it("preserves the late optical grazing alpha including normal direction and the .86 cap", () => {
    for (const opacity of [0.27, 0.36, 0.42, 0.9]) for (const cosine of [-1, -0.7, 0, 0.2, 1]) {
      const normal = vec3(Math.sqrt(1 - cosine * cosine), 0, cosine);
      expect(evaluate(archiveInternalAlphaNode(float(opacity), normal, vec3(0, 0, -9)))).toBeCloseTo(Math.min(0.86, opacity + 0.42 * (1 - Math.abs(cosine)) ** 3), 14);
    }
  });
});

describe("Pinned physical refraction graph parity", () => {
  it("retains nonuniform model scale and normalized Snell refraction", () => {
    const model = new THREE.Matrix4().makeRotationZ(0.73).scale(new THREE.Vector3(2, 3, 4));
    const ray = archiveVolumeTransmissionRay(vec3(0, 0, 4), vec3(0.6, 0, 0.8), float(0.12), float(1.46), mat4(model));
    const x = -0.6 / 1.46;
    expectVector(evaluate(ray), [x * 0.12 * 2, 0, -Math.sqrt(1 - x * x) * 0.12 * 4]);
  });

  it("uses Beer attenuation and the pinned zero sentinel for infinite attenuation distance", () => {
    for (const distance of [0, 0.1, 1.2, 8]) {
      expectVector(evaluate(archiveVolumeAttenuation(float(distance), vec3(0.8, 0.6, 0.3), float(2))), [0.8, 0.6, 0.3].map(c => c ** (distance / 2)));
      expectVector(evaluate(archiveVolumeAttenuation(float(distance), vec3(0.8, 0.6, 0.3), float(0))), [1, 1, 1]);
    }
  });

  const bicubicShader = shaderCall(textureBicubicLevel(viewportOpaqueMipTexture(), float(0))).shaderNode;
  const dfgShader = shaderCall(DFGLUT({ roughness: float(0.42), dotNV: float(0.8) })).shaderNode;
  const framebuffer = [0.66, 0.54, 0.43, 0.62], lut = [0.7, 0.13];
  const diffuse = [0.82, 0.48, 0.24], f0 = [0.04, 0.05, 0.06], attenuation = [0.7, 0.8, 0.9];
  const columns = [[2, 0, 0, 0], [0, 3, 0, 0], [0, 0, 4, 0], [0, 0, 0, 1]];
  const identity = [[1, 0, 0, 0], [0, 1, 0, 0], [0, 0, 1, 0], [0, 0, 0, 1]];
  function refractionBindings(spread = 0): Bindings {
    const values = binding([normalWorld, [0, 0, 1]], [cameraPosition, [0.7, 0.2, 1.1]],
      [positionWorld, [0.1, 0.2, 0.3]], [diffuseColor, [...diffuse, 0.61]],
      [specularColor, f0], [specularF90, 0.9], [metalness, 0.3], [roughness, 0.42],
      [ior, 1.46], [thickness, 0.12], [modelWorldMatrix, columns],
      [cameraViewMatrix, identity], [cameraProjectionMatrix, identity],
      [attenuationColor, attenuation], [attenuationDistance, 2], [dispersion, spread], [screenSize, [1920, 1080]]);
    // Stub ONLY sampled texels/LUT. All refraction, dispersion, Beer, Fresnel and alpha arithmetic is real TSL.
    values.set(bicubicShader.uuid, framebuffer); values.set(dfgShader.uuid, lut);
    return values;
  }

  it.each([0, 0.35])("preserves Fresnel, metallic diffuse, transmission alpha and RGB dispersion %f", spread => {
    const values = refractionBindings(spread);
    const output = archiveIBLVolumeRefraction(float(0.8), vec2(0.1, 0.2), THREE.FrontSide, spread > 0);
    const halfSpread = (1.46 - 1) * spread * 0.025;
    const etas = [1.46 - halfSpread, 1.46, 1.46 + halfSpread];
    const transmittance = diffuse.map((v, i) => {
      const x = -0.6 / etas[i], rayLength = Math.hypot(x * 0.12 * 2, -Math.sqrt(1 - x * x) * 0.12 * 4);
      return v * (1 - 0.3) * attenuation[i] ** (rayLength / 2);
    });
    const rgb = transmittance.map((v, i) => (1 - (lerp(f0[i], diffuse[i], 0.3) * lut[0] + 0.9 * lut[1])) * v * framebuffer[i]);
    // Pinned r183 uses vec4() (alpha=1), not vec4(0), before its three += samples.
    const sampledAlpha = spread > 0 ? (1 + 3 * framebuffer[3]) / 3 : framebuffer[3];
    const alpha = 1 - (1 - sampledAlpha) * transmittance.reduce((a, b) => a + b) / 3;
    expectVector(evaluate(output, values), [...rgb, alpha]);
  });

  it("uses the same public opaque bicubic sampler, bounded final roughness LOD, and flipped projected UV", () => {
    const call = archiveIBLVolumeRefraction(float(0.8), vec2(0.1, 0.2), THREE.FrontSide, false);
    const expanded = expandShader(call);
    const sample = expanded.nodes.flatMap(n => walk(n)).find(n => n.isShaderCallNodeInternal && n.shaderNode === bicubicShader)!;
    expect(sample).toBeDefined();
    const texture = sample.rawInputs[0];
    const baseTexture = (n: Graph): Graph => n.referenceNode ? baseTexture(n.referenceNode) : n;
    expect(texture.generateMipmaps).toBe(true);
    expect(baseTexture(texture)).toBe(baseTexture(graph(viewportOpaqueMipTexture())));
    const values = refractionBindings();
    expect(evaluate(sample.rawInputs[1], values)).toBeCloseTo(frostedTransmissionLod(Math.hypot(0.1 * 1920, 0.2 * 1080), 1920, 0.42, 0.8, 1.46), 12);
    runAssignments(expanded.nodes, values);
    const rayX = -0.6 / 1.46 * 0.12 * 2;
    expectVector(evaluate(texture.uvNode, values), [(0.1 + rayX + 1) / 2, 1 - (0.2 + 1) / 2]);
    const back = expandShader(archiveIBLVolumeRefraction(float(0.8), vec2(0.1, 0.2), THREE.BackSide, false));
    const backSample = back.nodes.flatMap(n => walk(n)).find(n => n.isShaderCallNodeInternal && n.shaderNode === bicubicShader)!;
    expect(backSample.rawInputs[0].generateMipmaps).toBe(true);
    expect(baseTexture(backSample.rawInputs[0])).not.toBe(baseTexture(texture));
  });
});

describe("WebGPU material data ownership and lifecycle", () => {
  it("retains supplied plain handles and copies CPU properties without taking texture ownership", () => {
    const source = new THREE.MeshPhysicalMaterial({ color: "#ebbd75", transmission: 0.91, ior: 1.46, roughness: 0.42,
      thickness: 0.17, attenuationColor: "#ded4c7", attenuationDistance: 2, clearcoat: 0.4, clearcoatRoughness: 0.23,
      metalness: 0.07, envMapIntensity: 0.6, opacity: 0.63, transparent: true, side: THREE.DoubleSide, vertexColors: true });
    source.map = new THREE.Texture(); source.normalMap = new THREE.Texture(); source.normalScale.set(0.3, 0.8);
    source.envMapRotation.set(0.1, 0.2, 0.3); source.iridescenceThicknessRange = [110, 270];
    source.blending = THREE.CustomBlending; source.blendSrcAlpha = THREE.OneFactor;
    source.userData = { opticalMetadata: { label: "preserve" } };
    const supplied = options();
    const material = createArchiveNodeMaterial(source, supplied) as ArchivePhysicalNodeMaterial;
    expect(material.isNodeMaterial).toBe(true);
    expect(material).not.toBe(source);
    for (const key of ["transmission", "ior", "thickness", "attenuationDistance", "clearcoat", "clearcoatRoughness", "metalness", "envMapIntensity", "opacity", "transparent", "side", "vertexColors", "blending", "blendSrcAlpha"] as const) expect(material[key]).toEqual(source[key]);
    expect(material.map).toBe(source.map); expect(material.normalMap).toBe(source.normalMap);
    for (const key of ["color", "attenuationColor", "normalScale", "envMapRotation", "iridescenceThicknessRange"] as const) {
      expect(material[key]).toEqual(source[key]); expect(material[key]).not.toBe(source[key]);
    }
    expect(material.userData.opticalMetadata).toEqual(source.userData.opticalMetadata);
    expect(material.userData.opticalMetadata).not.toBe(source.userData.opticalMetadata);
    const controls = getArchiveNodeControls(material)!;
    for (const key of ["quality", "clarity", "theme", "subdued"] as const) expect(controls[key]).toBe(supplied[key]);
    expect(material.userData.appearance).toBe(controls.quality);
    expect(material.userData.glassClarity).toBe(controls.clarity);
    expect(material.userData.themeAmount).toBe(controls.theme);
    expect(material.userData.subduedIndex).toBe(controls.subdued);
    expect(JSON.parse(JSON.stringify(material.userData)).archiveNodeControls).toEqual(controls);
    expect(JSON.stringify(material.userData)).not.toMatch(/isNode|uuid|ReferenceNode/);
    expect(source.userData.archiveNodeControls).toBeUndefined();
    expect(source.color.getHexString()).toBe("ebbd75");
  });

  it("copies physical properties added to a Standard glTF material without resetting its IOR", () => {
    const source = new THREE.MeshStandardMaterial({ roughness: 0.21 });
    Object.assign(source, { transmission: 0.9, ior: 1.46, thickness: 0.12, attenuationDistance: 2, attenuationColor: new THREE.Color("#eee6df") });
    const material = createArchiveNodeMaterial(source, options()) as ArchivePhysicalNodeMaterial;
    expect(material.transmission).toBe(0.9); expect(material.ior).toBe(1.46); expect(material.thickness).toBe(0.12);
    expect(material.clearcoat).toBe(0); expect(material.sheen).toBe(0);
    expect(material.attenuationColor).toEqual(graph(source).attenuationColor);
  });

  it.each(["physical", "basic"])("supports no-arg %s clone/copy with independent controls and shared maps", kind => {
    const source = kind === "physical" ? new THREE.MeshPhysicalMaterial({ transmission: 0.82, ior: 1.46 }) : new THREE.MeshBasicMaterial({ color: "#dfcab8", opacity: 0.38, transparent: true });
    source.map = new THREE.Texture();
    const material = createArchiveNodeMaterial(source, options({ surface: kind === "physical" ? "Frosted_Polymer" : "Printed_Canvas" }));
    const clone = material.clone();
    const copy = kind === "physical" ? new ArchivePhysicalNodeMaterial().copy(material) : new ArchiveBasicNodeMaterial().copy(material);
    for (const target of [clone, copy]) {
      expect(target.constructor).toBe(material.constructor);
      expect(graph(target).map).toBe(source.map);
      expect(graph(target).color).toEqual(graph(material).color);
      expect(graph(target).color).not.toBe(graph(material).color);
      expect(target.opacity).toBe(material.opacity);
      expect(getArchiveNodeControls(target)).toEqual(getArchiveNodeControls(material));
      for (const name of ["quality", "clarity", "theme", "subdued"] as const) expect(getArchiveNodeControls(target)![name]).not.toBe(getArchiveNodeControls(material)![name]);
      expect(target.userData.themeAmount).toBe(getArchiveNodeControls(target)!.theme);
      getArchiveNodeControls(target)!.theme.value = 0.97;
      expect(getArchiveNodeControls(material)!.theme.value).toBe(0.2);
      if (target instanceof ArchivePhysicalNodeMaterial) {
        expect(target.ior).toBe(1.46); expect(target.transmission).toBe(0.82);
        const lighting = target.setupLightingModel() as ArchiveFrostedLightingModel;
        expect(graph(lighting.quality).object).toBe(getArchiveNodeControls(target)!.quality);
        expect(walk(target.roughnessNode).filter(n => n.object).every(n => n.object !== getArchiveNodeControls(material)!.quality && n.object !== getArchiveNodeControls(material)!.clarity)).toBe(true);
      }
    }
    expect(getArchiveNodeControls(clone)!.theme).not.toBe(getArchiveNodeControls(copy)!.theme);
    expect(new ArchiveFrostedLightingModel().archiveTransmission).toBe(false);
  });

  it("rebinds returning Object3D copies using their JSON-copied handles", () => {
    const supplied = options();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), createArchiveNodeMaterial(new THREE.MeshPhysicalMaterial({ transmission: 0.9 }), supplied));
    Object.assign(mesh.userData, { surface: supplied.surface, appearance: supplied.quality, glassClarity: supplied.clarity, themeAmount: supplied.theme, subduedIndex: supplied.subdued });
    const returning = mesh.clone();
    expect(returning.material).toBe(mesh.material); // Three's documented Object3D ownership rule.
    returning.material = createArchiveNodeMaterial(returning.material, { surface: returning.userData.surface, instanced: false, hasLow: true,
      quality: returning.userData.appearance, clarity: returning.userData.glassClarity, theme: returning.userData.themeAmount, subdued: returning.userData.subduedIndex });
    returning.userData.appearance.value = 0.1;
    expect(supplied.quality!.value).toBe(0.7);
    expect(getArchiveNodeControls(returning.material)!.quality).toBe(returning.userData.appearance);
    expect(graph((graph(returning.material).setupLightingModel() as ArchiveFrostedLightingModel).quality).object).toBe(returning.userData.appearance);
  });

  it("still accepts existing CardAppearance.apply/setClarity/setTheme CPU updates", () => {
    const high = new THREE.MeshPhysicalMaterial({ color: "#fffdfa", transmission: 0.9, thickness: 0.12, attenuationDistance: 2 });
    const low = new THREE.MeshPhysicalMaterial({ color: "#fff7ed", transmission: 0.78, thickness: 0.28, attenuationDistance: 1.2 });
    const appearance = new CardAppearance(); appearance.register("Frosted_Polymer", high, low);
    const c = options();
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), createArchiveNodeMaterial(high, c));
    Object.assign(mesh.userData, { surface: c.surface, appearance: c.quality, glassClarity: c.clarity, themeAmount: c.theme, subduedIndex: c.subdued });
    const group = new THREE.Group(); group.add(mesh);
    appearance.apply(group, 0.35); appearance.setClarity(group, 0.6); appearance.setTheme(group, 0.9, true);
    const material = mesh.material as ArchivePhysicalNodeMaterial;
    expect(material.transmission).toBeCloseTo(THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.78, 0.9, 0.35), 0.985, 0.6));
    expect(material.thickness).toBeCloseTo(THREE.MathUtils.lerp(THREE.MathUtils.lerp(0.28, 0.12, 0.35), 0.018, 0.6));
    expect(c.quality!.value).toBe(0.35); expect(c.clarity!.value).toBe(0.6); expect(c.theme!.value).toBe(0.9); expect(c.subdued!.value).toBe(1);
  });

  it.each([["Optical_Glass_Body", 20], ["Optical_Glass_Roof", 24], ["Optical_Bridge_Glass", 26], ["Optical_Glass_Edge", 28]])("keeps %s in the opaque capture with order %i", (name, order) => {
    const source = new THREE.MeshPhysicalMaterial(); configureInternalOptics(String(name), source);
    const material = createArchiveNodeMaterial(source, options({ surface: String(name), hasLow: false })) as ArchivePhysicalNodeMaterial;
    for (const target of [material, material.clone()]) {
      expect(target.transmission).toBe(0); expect(target.transmissionNode).toBeNull(); expect(target.backdropNode).toBeNull();
      expect(target.transparent).toBe(false); expect(target.useTransmission).toBe(false);
      expect(target.blending).toBe(THREE.CustomBlending); expect(target.blendEquation).toBe(THREE.AddEquation);
      expect(target.blendSrc).toBe(THREE.SrcAlphaFactor); expect(target.blendDst).toBe(THREE.OneMinusSrcAlphaFactor);
      expect(target.blendSrcAlpha).toBe(THREE.OneFactor); expect(target.blendDstAlpha).toBe(THREE.OneMinusSrcAlphaFactor);
      expect(target.side).toBe(THREE.FrontSide); expect(target.depthWrite).toBe(false); expect(target.userData.opticalOrder).toBe(order);
      expect(target.color).toEqual(source.color); expect(target.roughness).toBe(source.roughness); expect(target.opacity).toBe(source.opacity);
    }
  });

  it("limits coverage to selected detail geometry and keeps the array's native roughness/LOD", () => {
    for (const c of [options({ instanced: true, hasLow: false }), options(), options({ surface: "Printed_Canvas", hasLow: false }), options({ surface: "Ivory_Edges" })]) {
      expect((createArchiveNodeMaterial(new THREE.MeshPhysicalMaterial(), c) as ArchivePhysicalNodeMaterial).maskNode).toBeNull();
    }
    const array = new ArchivePhysicalNodeMaterial(new THREE.MeshPhysicalMaterial({ roughness: 0.28, transmission: 0.78 }), options({ instanced: true }));
    expect(array.roughnessNode).toBeNull(); expect(array.roughness).toBe(0.28);
    expect(array.setupLightingModel()).toBeInstanceOf(PhysicalLightingModel);
    expect(array.setupLightingModel()).not.toBeInstanceOf(ArchiveFrostedLightingModel);
    const edges = new ArchivePhysicalNodeMaterial(new THREE.MeshPhysicalMaterial({ transmission: 0 }), options({ surface: "Optical_Edges", hasLow: false }));
    expect(edges.transmissionNode).toBeNull(); expect(edges.backdropNode).toBeNull(); expect(edges.useTransmission).toBe(false);
  });

  it("provides independent default handles and rejects unported arbitrary shaders", () => {
    const plain = { surface: "Printed_Canvas", instanced: false, hasLow: false };
    const a = createArchiveNodeMaterial(new THREE.MeshBasicMaterial(), plain), b = createArchiveNodeMaterial(new THREE.MeshBasicMaterial(), plain);
    expect(getArchiveNodeControls(a)!.quality.value).toBe(0);
    expect(getArchiveNodeControls(a)!.theme).not.toBe(getArchiveNodeControls(b)!.theme);
    expect(() => createArchiveNodeMaterial(new THREE.ShaderMaterial(), plain)).toThrow(/not arbitrary ShaderMaterial/);
  });
});

describe("WebGPU hook placement and physical feature parity", () => {
  it("themes AFTER the diffuse map/vertex product, and AFTER frost height tint", () => {
    const mapped = [0.17, 0.48, 0.29];
    const base = vi.spyOn(MeshPhysicalNodeMaterial.prototype, "setupDiffuseColor").mockImplementation(() => {
      diffuseColor.assign(vec4(vec3(...mapped as [number, number, number]), 0.7));
    });
    const c = options({ quality: { value: 0.3 }, clarity: { value: 0 }, theme: { value: 0.65 } });
    const material = new ArchivePhysicalNodeMaterial(new THREE.MeshPhysicalMaterial({ vertexColors: true, map: new THREE.Texture() }), c);
    const { nodes } = withStack(() => material.setupDiffuseColor({} as NodeBuilder));
    const values = binding([positionGeometry, [0, 1.48, 0]]);
    runAssignments(nodes, values);
    const tint = channels(evaluate(archiveFrostTintNode(float(0.4), float(0.3))));
    const dark = new THREE.Color("#626b70").toArray();
    expectVector(values.get(diffuseColor.uuid)!, [...mapped.map((v, i) => lerp(v * tint[i], dark[i], 0.65)), 0.7]);
    expect(base).toHaveBeenCalledOnce(); expect(material.colorNode).toBeNull();
  });

  it("transforms printed outgoing RGB before super applies fog, without replacing outputNode", () => {
    const fog = [0.1, 0.3, 0.2], fogAmount = 0.6, outgoing = [0.8, 0.5, 0.2];
    const base = vi.spyOn(MeshBasicNodeMaterial.prototype, "setupOutput").mockImplementation((_builder, node) => {
      const rgba = vec4(node);
      return vec4(mix(rgba.rgb, vec3(...fog as [number, number, number]), fogAmount), rgba.a);
    });
    const material = new ArchiveBasicNodeMaterial(new THREE.MeshBasicMaterial(), options({ surface: "Printed_Canvas", theme: { value: 0.75 } }));
    const { result } = withStack(() => material.setupOutput({} as NodeBuilder, vec4(vec3(...outgoing as [number, number, number]), 0.4)));
    const values = binding([diffuseColor, [0.2, 0.2, 0.2, 0.4]]);
    const themed = channels(evaluate(archivePrintedThemeNode(vec3(...outgoing as [number, number, number]), vec3(0.2), float(0.75))));
    expectVector(evaluate(result, values), [...themed.map((v, i) => lerp(v, fog[i], fogAmount)), 0.4]);
    expect(base).toHaveBeenCalledOnce(); expect(material.outputNode).toBeNull();
  });

  it("overrides internal alpha late from uniform opacity, not the alpha map or opaque alpha", () => {
    vi.spyOn(MeshPhysicalNodeMaterial.prototype, "setupOutput").mockImplementation((_builder, node) => node);
    const source = new THREE.MeshPhysicalMaterial({ opacity: 0.27, alphaMap: new THREE.Texture() });
    const material = new ArchivePhysicalNodeMaterial(source, options({ surface: "Optical_Glass_Body", hasLow: false }));
    const { result } = withStack(() => material.setupOutput({} as NodeBuilder, vec4(0.2, 0.3, 0.4, 1)));
    const referenceNode = walk(result).find(n => n.isMaterialReferenceNode)!;
    expect(referenceNode.property).toBe("opacity");
    expect(material.opacityNode).toBeNull();
    // The graph itself contains the correctly late alpha; no materialOpacity/alphaMap node is involved.
    expect(walk(result).filter(n => n.scope === "opacity")).toHaveLength(0);
    const values = binding([normalView, [0.6, 0, 0.8]], [positionView, [0, 0, -9]]);
    expectVector(evaluate(result, values, material), [0.2, 0.3, 0.4, 0.27 + 0.42 * 0.2 ** 3]);
    material.opacity = 0.42;
    expectVector(evaluate(result, values, material), [0.2, 0.3, 0.4, 0.42 + 0.42 * 0.2 ** 3]);
  });

  it("keeps every physical lobe, disables only native transmission, and installs backdrop before super.start", () => {
    const source = new THREE.MeshPhysicalMaterial({ transmission: 0.91, clearcoat: 0.4, sheen: 0.2, iridescence: 0.5, anisotropy: 0.6, dispersion: 0.3 });
    const material = new ArchivePhysicalNodeMaterial(source, options());
    const lighting = material.setupLightingModel() as ArchiveFrostedLightingModel;
    expect(lighting).toBeInstanceOf(PhysicalLightingModel); expect(lighting.transmission).toBe(false);
    expect(lighting.archiveTransmission).toBe(true); expect(material.useTransmission).toBe(true);
    for (const flag of ["clearcoat", "sheen", "iridescence", "anisotropy", "dispersion"] as const) expect(lighting[flag]).toBe(true);
    const builder = { context: {} } as NodeBuilder & { context: { backdrop?: Node; backdropAlpha?: Node } };
    const inherited = vi.spyOn(PhysicalLightingModel.prototype, "start").mockImplementation(() => {
      expect(builder.context.backdrop).toBeDefined(); expect(builder.context.backdropAlpha).toBeDefined();
    });
    const { nodes } = withStack(() => lighting.start(builder));
    expect(inherited).toHaveBeenCalledOnce();
    expect(nodes.some(n => n.isAssignNode && walk(n.targetNode).some(child => child.uuid === diffuseColor.uuid))).toBe(true);
    const values = binding([diffuseColor, [0.8, 0.5, 0.2, 0.61]], [transmission, 0.91], [builder.context.backdrop!, [0.1, 0.2, 0.3, 0.42]]);
    runAssignments(nodes, values);
    expectVector(values.get(diffuseColor.uuid)!, [0.8, 0.5, 0.2, 0.61 * lerp(1, 0.42, 0.91)]);
    expect(material.transmissionNode).toBeNull(); // native scalar/map controls still drive transmission.
    expect(material.backdropNode).toBeNull();
  });

  it("isolates bound theme-only and printed control nodes in the r183 builder-state cache", () => {
    for (const surface of ["Index_Inlay", "Ivory_Edges", "Printed_Canvas"]) {
      const source = surface === "Printed_Canvas" ? new THREE.MeshBasicMaterial() : new THREE.MeshPhysicalMaterial();
      const first = createArchiveNodeMaterial(source, options({ surface }));
      const second = createArchiveNodeMaterial(source, options({ surface }));
      const clone = first.clone();
      expect(first.customProgramCacheKey()).not.toBe(second.customProgramCacheKey());
      expect(first.customProgramCacheKey()).not.toBe(clone.customProgramCacheKey());
      const key = first.customProgramCacheKey();
      getArchiveNodeControls(first)!.theme.value = 0.7;
      getArchiveNodeControls(first)!.subdued.value = 0.9;
      expect(first.customProgramCacheKey()).toBe(key);
    }
  });

  it("keeps cache keys stable during scalar animation but separates structural shader variants", () => {
    const material = new ArchivePhysicalNodeMaterial(new THREE.MeshPhysicalMaterial(), options());
    const before = material.customProgramCacheKey();
    getArchiveNodeControls(material)!.quality.value = 0.17; getArchiveNodeControls(material)!.theme.value = 0.91;
    expect(material.customProgramCacheKey()).toBe(before);
    expect(new ArchivePhysicalNodeMaterial(new THREE.MeshPhysicalMaterial(), options({ instanced: true })).customProgramCacheKey()).not.toBe(before);
    expect(new ArchivePhysicalNodeMaterial(new THREE.MeshPhysicalMaterial(), options({ surface: "Index_Inlay" })).customProgramCacheKey()).not.toBe(before);
  });
});
