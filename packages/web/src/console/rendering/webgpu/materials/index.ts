import type { Material, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { ArchiveBasicNodeMaterial, ArchivePhysicalNodeMaterial } from "./archive-node-material.ts";
import type { ArchiveNodeControls } from "./controls.ts";

export type { ArchiveValueHandle, ArchiveNodeControls, ArchiveNodeControlState } from "./controls.ts";
export { getArchiveNodeControls } from "./controls.ts";
export { ArchiveBasicNodeMaterial, ArchivePhysicalNodeMaterial } from "./archive-node-material.ts";

/**
 * Port the archive's known GLSL hooks, not arbitrary onBeforeCompile code.
 * Pass a source AFTER the existing scene/palette/optics CPU configuration, and the
 * actual mesh.userData handles. Scalars, colors, maps and blending remain editable.
 * Does not mutate/dispose source, textures, geometry, or Object3D.userData.
 *
 * Factory calls retain supplied handles; Material.clone/copy create independent
 * handles available via getArchiveNodeControls. Object3D.clone shares materials:
 * call this factory with the cloned object's handles when material independence
 * is required. Instanced materials consume the existing archiveTheme attribute.
 *
 * Only use for the native scene. The independent legacy ModelViewer must keep
 * its original GLSL materials. Ordinary scene materials can use normal conversion.
 */
export function createArchiveNodeMaterial(source: Material, controls: ArchiveNodeControls): Material {
  if ((source as MeshBasicMaterial).isMeshBasicMaterial) return new ArchiveBasicNodeMaterial(source, controls);
  if ((source as MeshStandardMaterial).isMeshStandardMaterial) return new ArchivePhysicalNodeMaterial(source, controls);
  throw new TypeError(
    "createArchiveNodeMaterial supports archive MeshBasic/Standard/Physical materials, not arbitrary " + source.type + " shaders.",
  );
}
