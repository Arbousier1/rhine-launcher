import { Color } from "three";
import type { Node } from "three/webgpu";
import {
  abs, attribute, cameraProjectionMatrix, color, dot, float, fract, length,
  int, log2, max, min, mix, modelViewMatrix, normalize, positionGeometry, positionView,
  pow, reference, screenCoordinate, screenSize, smoothstep, varying, vec2, vec3, vec4,
} from "three/tsl";
import type { ArchiveNodeControlState } from "./controls.ts";

// Hex palette values are sRGB; GLSL vec3 literals below already are working-linear.
export const ARCHIVE_DARK_SURFACES: Readonly<Record<string, string>> = Object.freeze({
  Frosted_Polymer: "#626b70", Ivory_Edges: "#687277", Optical_Diffuser: "#192226",
  Titanium_Fasteners: "#b1b9bb", Index_Inlay: "#c6a36b", Printed_Label: "#303a3e",
  Subsurface_Optics: "#939e9f", Optical_Edges: "#bbc3bc", Carbon_Ink: "#b6bdb8",
});

export function archiveHeightNode() {
  // Must precede model/instance transforms: the cover is 3.7 geometry units high.
  return varying(positionGeometry.y.div(3.7), "vArchiveHeight");
}

export function archiveProjectedAxisNode() {
  return varying(vec2(
    vec4(cameraProjectionMatrix.element(int(0))).x.mul(vec4(modelViewMatrix.element(int(1))).x),
    vec4(cameraProjectionMatrix.element(int(1))).y.mul(vec4(modelViewMatrix.element(int(1))).y),
  ).mul(1.85).div(max(0.0001, abs(positionView.z))), "vArchiveProjectedAxis");
}

export function archiveRevealNode(clarity: Node<"float">, height: Node<"float">) {
  const edge = float(1).sub(clarity.clamp(0, 1).mul(1.24));
  return smoothstep(edge, edge.add(0.24), height.clamp(0, 1));
}

export function archiveFrostTintNode(height: Node<"float">, quality: Node<"float">) {
  return mix(mix(vec3(0.40, 0.30, 0.20), vec3(1, 0.98, 0.94), smoothstep(0.1, 1, height)), vec3(1), quality);
}

/** Raw replacement for roughnessFactor; MeshPhysicalNodeMaterial still applies getRoughness. */
export function archiveRoughnessNode(quality: Node<"float">, reveal: Node<"float">) {
  return mix(mix(0.28, 0.42, quality), 0.025, reveal);
}

export function archiveCoverageNode(coordinate: Node<"vec2"> = screenCoordinate, size: Node<"vec2"> = screenSize) {
  // TSL screenCoordinate is top-left; legacy gl_FragCoord is bottom-left, even in render targets.
  const glCoordinate = vec2(coordinate.x, size.y.sub(coordinate.y));
  return fract(float(52.9829189).mul(fract(dot(glCoordinate, vec2(0.06711056, 0.00583715)))));
}

/** Final (geometry-adjusted) physical roughness belongs here, not the raw frost roughness. */
export function archiveTransmissionLodNode(roughness: Node<"float">, ior: Node<"float">, size: Node<"vec2">, projectedAxis: Node<"vec2">, quality: Node<"float">) {
  const iorScale = ior.mul(2).sub(2).clamp(0, 1);
  const native = log2(size.x).mul(roughness).mul(iorScale);
  const strength = roughness.sub(0.025).div(0.395).clamp(0, 1);
  const clear = log2(size.x).mul(0.025).mul(iorScale);
  const bound = log2(max(clear.exp2(), length(projectedAxis.mul(size)).mul(0.016).mul(pow(strength, 1.15))));
  return mix(native, min(native, bound), quality);
}

export function archiveDarkSurfaceNode(surface: string, instanced: boolean, reveal: Node<"float">, subdued: Node<"float">) {
  const dark = color(new Color(ARCHIVE_DARK_SURFACES[surface] ?? (surface.includes("Orange") ? "#bb8850" : "#969f9f")));
  if (surface === "Frosted_Polymer" && !instanced) return mix(dark, vec3(0.92, 0.96, 0.97), reveal);
  if (surface === "Index_Inlay") return mix(dark, vec3(0.030, 0.042, 0.048), subdued);
  return dark.rgb;
}

export function archivePrintedThemeNode(outgoing: Node<"vec3">, diffuse: Node<"vec3">, theme: Node<"float">) {
  const luminance = dot(diffuse, vec3(0.2126, 0.7152, 0.0722));
  const dark = mix(vec3(0.023, 0.032, 0.037), vec3(0.78, 0.78, 0.71), smoothstep(0.12, 0.65, luminance).oneMinus());
  return mix(outgoing, dark, theme);
}

export function archiveInternalAlphaNode(opacity: Node<"float">, normal: Node<"vec3">, viewPosition: Node<"vec3">) {
  const grazing = abs(dot(normal, normalize(viewPosition.negate()))).oneMinus();
  return min(0.86, opacity.add(pow(grazing, 3).mul(0.42)));
}

export function createArchiveSurfaceNodes(controls: ArchiveNodeControlState) {
  const quality = reference("value", "float", controls.quality);
  const clarity = reference("value", "float", controls.clarity);
  const theme = controls.instanced
    ? varying(float(attribute("archiveTheme", "float")), "vRhineTheme")
    : reference("value", "float", controls.theme);
  const subdued = reference("value", "float", controls.subdued);
  const height = archiveHeightNode();
  const projectedAxis = archiveProjectedAxisNode();
  const reveal = archiveRevealNode(clarity, height);
  return { quality, clarity, theme, subdued, height, projectedAxis, reveal };
}
