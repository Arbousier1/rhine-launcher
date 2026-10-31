/**
 * Pure layout for the archive rack.
 *
 * The rack is a shallow tray of glass slabs: columns run left→right, rows run
 * front→back. Keeping the maths here lets the scene, the lite fallback and the
 * tests agree on one arrangement without a WebGL context.
 */
export interface ArraySlot {
  index: number
  col: number
  row: number
  /** World x (left negative). */
  x: number
  /** World z (front positive, toward the camera). */
  z: number
}

export interface ArrayLayoutOptions {
  /** Force a column count (clamped 1..5). */
  columns?: number
  /** Horizontal distance between slab centres. */
  pitchX?: number
  /** Depth distance between rows. */
  pitchZ?: number
  /** Rows per column before a new column starts. */
  rowsPerColumn?: number
}

/**
 * Place `count` slabs centred on the origin.
 *
 * The first slab (index 0) sits front-left of the last row; the selected slab
 * is always addressed by index, so the scene never depends on DOM order.
 */
export function arrayLayout(count: number, options: ArrayLayoutOptions = {}): ArraySlot[] {
  const total = Math.max(0, Math.floor(count))
  if (!total) return []
  const pitchX = options.pitchX ?? 2.9
  const pitchZ = options.pitchZ ?? 1.95
  const rowsPerColumn = Math.max(1, options.rowsPerColumn ?? 4)
  const columns = Math.min(
    5,
    Math.max(1, options.columns ?? Math.ceil(total / rowsPerColumn)),
  )
  const rows = Math.ceil(total / columns)
  const slots: ArraySlot[] = []
  for (let index = 0; index < total; index += 1) {
    const col = Math.floor(index / rows)
    const row = index % rows
    slots.push({
      index,
      col,
      row,
      x: (col - (columns - 1) / 2) * pitchX,
      z: (row - (rows - 1) / 2) * pitchZ,
    })
  }
  return slots
}

/** Bounding radius used to frame the camera without clipping the rack. */
export function arrayBounds(slots: readonly ArraySlot[]): { radius: number; width: number; depth: number } {
  if (!slots.length) return { radius: 3, width: 0, depth: 0 }
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const slot of slots) {
    minX = Math.min(minX, slot.x)
    maxX = Math.max(maxX, slot.x)
    minZ = Math.min(minZ, slot.z)
    maxZ = Math.max(maxZ, slot.z)
  }
  const width = maxX - minX
  const depth = maxZ - minZ
  return { radius: Math.hypot(width, depth) / 2, width, depth }
}
