import {
  AddEquation, CustomBlending, FrontSide, OneFactor, OneMinusSrcAlphaFactor,
  SrcAlphaFactor,
} from "three";
import type { Material } from "three";
import { MeshBasicNodeMaterial, MeshPhysicalNodeMaterial } from "three/webgpu";
import type { Node, NodeBuilder } from "three/webgpu";
import { diffuseColor, float, materialReference, mix, normalView, positionView, vec4 } from "three/tsl";
import {
  cloneArchiveControls, copyArchiveMaterialProperties, emptyArchiveControls,
  getArchiveNodeControls, storeArchiveControls,
} from "./controls.ts";
import type { ArchiveNodeControls, ArchiveNodeControlState } from "./controls.ts";
import {
  archiveCoverageNode, archiveDarkSurfaceNode, archiveFrostTintNode,
  archiveInternalAlphaNode, archivePrintedThemeNode, archiveRoughnessNode,
  createArchiveSurfaceNodes,
} from "./surface-nodes.ts";
import { ArchiveFrostedLightingModel } from "./frosted-lighting.ts";

type SurfaceNodes = ReturnType<typeof createArchiveSurfaceNodes>;
const physicalNodeDefaults = new MeshPhysicalNodeMaterial();
const basicNodeDefaults = new MeshBasicNodeMaterial();

export const ARCHIVE_INTERNAL_OPTICAL_ORDERS: Readonly<Record<string, number>> = Object.freeze({
  Optical_Glass_Body: 20, Optical_Glass_Roof: 24,
  Optical_Bridge_Glass: 26, Optical_Glass_Edge: 28,
});

// r183 reuses NodeBuilderState, including bound ReferenceNodes, for identical keys.
// Hook-only nodes are not direct material properties, so include their identities
// explicitly. Numeric handle values must never enter this key (they animate).
function controlCacheKey(nodes: SurfaceNodes) {
  return [nodes.quality.uuid, nodes.clarity.uuid, nodes.theme.uuid, nodes.subdued.uuid].join(",");
}

function controlsForCopy(source: Material): ArchiveNodeControls {
  const controls = getArchiveNodeControls(source);
  return controls ? cloneArchiveControls(controls) : emptyArchiveControls();
}

function isNodeMaterial(source: Material): source is MeshPhysicalNodeMaterial {
  return (source as MeshPhysicalNodeMaterial).isNodeMaterial === true;
}

function selectiveGeometry(controls: ArchiveNodeControlState) {
  return !controls.instanced && !controls.hasLow && controls.surface !== "" &&
    controls.surface !== "Frosted_Polymer" && controls.surface !== "Printed_Canvas";
}

function setupArchiveDiffuse(controls: ArchiveNodeControlState, nodes: SurfaceNodes) {
  const { surface, instanced } = controls;
  if (!surface || surface === "Printed_Canvas") return;
  if (surface === "Frosted_Polymer") {
    // Instanced array GLSL only applies the height tint, not selected-card quality.
    diffuseColor.rgb.mulAssign(archiveFrostTintNode(nodes.height, instanced ? float(0) : nodes.quality));
  }
  const dark = archiveDarkSurfaceNode(surface, instanced, nodes.reveal, nodes.subdued);
  diffuseColor.rgb.assign(mix(diffuseColor.rgb, dark, nodes.theme));
}

function setupArchiveOutput(controls: ArchiveNodeControlState, nodes: SurfaceNodes, output: Node<"vec4">, internal: boolean) {
  if (controls.surface === "Printed_Canvas") {
    // Transform outgoing light, using the mapped/vertex-colored diffuse RGB for luminance.
    // This must run BEFORE super.setupOutput applies fog and premultiplied alpha.
    output = vec4(archivePrintedThemeNode(output.rgb, diffuseColor.rgb, nodes.theme), output.a);
  }
  if (internal) {
    // Uniform opacity alone, NOT materialOpacity (which includes alphaMap).
    // Override late: opaque setupDiffuseColor may already have forced alpha to one.
    output = vec4(output.rgb, archiveInternalAlphaNode(float(materialReference("opacity", "float")), normalView, positionView));
  }
  return output;
}

/** Physical surfaces, including selected frost, native array frost and optical interiors. */
export class ArchivePhysicalNodeMaterial extends MeshPhysicalNodeMaterial {
  static override get type() { return "ArchivePhysicalNodeMaterial"; }
  private archive!: ArchiveNodeControlState;
  private archiveNodes!: SurfaceNodes;
  private archiveInternal = false;

  constructor(source?: Material, controls?: ArchiveNodeControls) {
    super();
    if (source) {
      if (isNodeMaterial(source)) super.copy(source);
      copyArchiveMaterialProperties(this, source, true);
    }
    this.configure(controls ?? (source ? controlsForCopy(source) : emptyArchiveControls()));
  }

  private configure(controls: ArchiveNodeControls) {
    this.archive = storeArchiveControls(this, controls);
    this.archiveNodes = createArchiveSurfaceNodes(this.archive);
    const selectedFrost = controls.surface === "Frosted_Polymer" && !controls.instanced;
    this.roughnessNode = selectedFrost ? archiveRoughnessNode(this.archiveNodes.quality, this.archiveNodes.reveal) : null;
    this.maskNode = selectiveGeometry(this.archive) ? this.archiveNodes.quality.greaterThan(archiveCoverageNode()) : null;
    this.archiveInternal = Boolean(ARCHIVE_INTERNAL_OPTICAL_ORDERS[controls.surface] || this.userData.opticalOrder);
    if (this.archiveInternal) {
      // Keep these thin blended surfaces in WebGPU's opaque transmission capture.
      // A nonnull transmissionNode, even uniform(0), moves them to the transparent list.
      this.transmission = 0;
      this.transmissionNode = null;
      this.backdropNode = null;
      this.backdropAlphaNode = null;
      this.transparent = false;
      this.blending = CustomBlending;
      this.blendEquation = AddEquation;
      this.blendEquationAlpha = AddEquation;
      this.blendSrc = SrcAlphaFactor;
      this.blendDst = OneMinusSrcAlphaFactor;
      this.blendSrcAlpha = OneFactor;
      this.blendDstAlpha = OneMinusSrcAlphaFactor;
      this.depthWrite = false;
      this.side = FrontSide;
      this.userData.opticalOrder = ARCHIVE_INTERNAL_OPTICAL_ORDERS[controls.surface] ?? this.userData.opticalOrder;
    }
    this.needsUpdate = true;
  }

  override setupDiffuseColor(builder: NodeBuilder) {
    super.setupDiffuseColor(builder);
    // Do not use colorNode: it runs before map/vertex/instance color multiplication.
    setupArchiveDiffuse(this.archive, this.archiveNodes);
  }

  override setupOutput(builder: NodeBuilder, output: Node) {
    return super.setupOutput(builder, setupArchiveOutput(this.archive, this.archiveNodes, vec4(output), this.archiveInternal));
  }

  override setupLightingModel() {
    if (this.archive.surface === "Frosted_Polymer" && !this.archive.instanced) {
      return new ArchiveFrostedLightingModel(this, this.archiveNodes.quality, this.archiveNodes.projectedAxis);
    }
    return super.setupLightingModel();
  }

  override customProgramCacheKey() {
    const { surface, instanced, hasLow } = this.archive;
    return super.customProgramCacheKey() + controlCacheKey(this.archiveNodes) + JSON.stringify(["archive-r183-v1", surface, instanced, hasLow, this.archiveInternal]);
  }

  override copy(source: Material): this {
    if (source === this) return this;
    super.copy(isNodeMaterial(source) ? source : physicalNodeDefaults);
    copyArchiveMaterialProperties(this, source, true);
    // Base copy shares nodes. Recreate every archive reference against cloned handles.
    this.configure(controlsForCopy(source));
    return this;
  }
}

/** Unlit printed canvas; also preserves ordinary basic-material maps and alpha semantics. */
export class ArchiveBasicNodeMaterial extends MeshBasicNodeMaterial {
  static override get type() { return "ArchiveBasicNodeMaterial"; }
  private archive!: ArchiveNodeControlState;
  private archiveNodes!: SurfaceNodes;

  constructor(source?: Material, controls?: ArchiveNodeControls) {
    super();
    if (source) {
      if (isNodeMaterial(source)) super.copy(source);
      copyArchiveMaterialProperties(this, source, false);
    }
    this.configure(controls ?? (source ? controlsForCopy(source) : emptyArchiveControls()));
  }

  private configure(controls: ArchiveNodeControls) {
    this.archive = storeArchiveControls(this, controls);
    this.archiveNodes = createArchiveSurfaceNodes(this.archive);
    this.maskNode = selectiveGeometry(this.archive) ? this.archiveNodes.quality.greaterThan(archiveCoverageNode()) : null;
    this.needsUpdate = true;
  }

  override setupDiffuseColor(builder: NodeBuilder) {
    super.setupDiffuseColor(builder);
    setupArchiveDiffuse(this.archive, this.archiveNodes);
  }

  override setupOutput(builder: NodeBuilder, output: Node) {
    return super.setupOutput(builder, setupArchiveOutput(this.archive, this.archiveNodes, vec4(output), false));
  }

  override customProgramCacheKey() {
    const { surface, instanced, hasLow } = this.archive;
    return super.customProgramCacheKey() + controlCacheKey(this.archiveNodes) + JSON.stringify(["archive-r183-v1", surface, instanced, hasLow]);
  }

  override copy(source: Material): this {
    if (source === this) return this;
    super.copy(isNodeMaterial(source) ? source : basicNodeDefaults);
    copyArchiveMaterialProperties(this, source, false);
    this.configure(controlsForCopy(source));
    return this;
  }
}
