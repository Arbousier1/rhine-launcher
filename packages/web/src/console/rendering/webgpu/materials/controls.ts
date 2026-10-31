import { Material, MeshBasicMaterial, MeshPhysicalMaterial } from "three";

/** Plain, JSON-cloneable CPU handles; never put a TSL node in Object3D.userData. */
export interface ArchiveValueHandle { value: number }

export interface ArchiveNodeControls {
  surface: string;
  instanced: boolean;
  hasLow: boolean;
  quality?: ArchiveValueHandle;
  clarity?: ArchiveValueHandle;
  theme?: ArchiveValueHandle;
  subdued?: ArchiveValueHandle;
}

export type ArchiveNodeControlState = Required<ArchiveNodeControls>;

export function completeArchiveControls(controls: ArchiveNodeControls): ArchiveNodeControlState {
  return {
    surface: controls.surface,
    instanced: controls.instanced,
    hasLow: controls.hasLow,
    // These defaults match CardAppearance.prepare, not an assumed high-quality card.
    quality: controls.quality ?? { value: 0 },
    clarity: controls.clarity ?? { value: 0 },
    theme: controls.theme ?? { value: 0 },
    subdued: controls.subdued ?? { value: 0 },
  };
}

export function cloneArchiveControls(controls: ArchiveNodeControlState): ArchiveNodeControlState {
  return {
    surface: controls.surface,
    instanced: controls.instanced,
    hasLow: controls.hasLow,
    quality: { value: controls.quality.value },
    clarity: { value: controls.clarity.value },
    theme: { value: controls.theme.value },
    subdued: { value: controls.subdued.value },
  };
}

/** Returns the material's plain handles. The caller still owns each supplied handle. */
export function getArchiveNodeControls(material: Material): ArchiveNodeControlState | undefined {
  return material.userData.archiveNodeControls as ArchiveNodeControlState | undefined;
}

export function storeArchiveControls(material: Material, controls: ArchiveNodeControls) {
  const state = completeArchiveControls(controls);
  material.userData.archiveNodeControls = state;
  // Keep aliases coherent even after Material.copy's JSON round trip.
  material.userData.appearance = state.quality;
  material.userData.glassClarity = state.clarity;
  material.userData.themeAmount = state.theme;
  material.userData.subduedIndex = state.subdued;
  return state;
}

export function emptyArchiveControls(): ArchiveNodeControls {
  return { surface: "", instanced: false, hasLow: true };
}

const basicDefaults = new MeshBasicMaterial();
const physicalDefaults = new MeshPhysicalMaterial();
const identity = new Set(["id", "uuid", "type", "version", "userData"]);

type Properties = Record<string, unknown>;

function copyValue(value: unknown): unknown {
  if (!value || typeof value !== "object") return value;
  const object = value as { isTexture?: boolean; clone?: () => unknown };
  // Match Three Material.clone: textures are shared resources, colors/vectors are not.
  if (object.isTexture) return value;
  if (object.clone) return object.clone();
  if (Array.isArray(value)) return value.map(copyValue);
  return { ...value };
}

/**
 * r183 NodeMaterial.copy copies node inputs and base Material fields, but NOT the
 * basic/standard/physical scalar fields. Copy their actual installed schema too.
 * Accessors matter: a glTF Standard material can have added physical properties
 * (e.g. transmission) without the Physical material's private backing fields.
 */
export function copyArchiveMaterialProperties(target: Material, source: Material, physical: boolean) {
  Material.prototype.copy.call(target, source);
  const defaults = physical ? physicalDefaults : basicDefaults;
  const fields = new Set(Object.keys(defaults));
  for (let prototype = Object.getPrototypeOf(defaults); prototype; prototype = Object.getPrototypeOf(prototype)) {
    for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(prototype))) {
      if (descriptor.get && descriptor.set) fields.add(key);
    }
  }
  const input = source as unknown as Properties;
  const output = target as unknown as Properties;
  const fallback = defaults as unknown as Properties;
  for (const key of fields) {
    if (identity.has(key) || key.startsWith("_") || key.startsWith("is") || key === "needsUpdate") continue;
    // Physical reflectivity is an alias whose setter changes ior; copy canonical ior once.
    if (physical && key === "reflectivity") continue;
    const value = key in input && input[key] !== undefined ? input[key] : fallback[key];
    if (typeof value !== "function") output[key] = copyValue(value);
  }
}
