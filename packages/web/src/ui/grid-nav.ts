/**
 * Shared session-level hover/selection behaviour for the archive grid.
 * Kept as plain functions so it can be unit tested without a DOM.
 */

/** Clamp an index into `[0, length - 1]`; returns -1 for an empty list. */
export function clampIndex(index: number, length: number): number {
  if (length <= 0) return -1
  if (index < 0) return 0
  if (index >= length) return length - 1
  return index
}

/** Wrap an index around a bounded list. */
export function wrapIndex(index: number, length: number): number {
  if (length <= 0) return -1
  return ((index % length) + length) % length
}

/**
 * Move through a column-major grid.
 * `delta` of -1/+1 walks one cell, -columns/+columns walks one row.
 */
export function moveInGrid(current: number, delta: number, length: number): number {
  if (length <= 0) return -1
  const next = current + delta
  if (next < 0 || next >= length) return current
  return next
}

/** Index of the item with the given id, or -1. */
export function indexOfId<T extends { id: string }>(items: T[], id: string | undefined | null): number {
  if (!id) return -1
  return items.findIndex((item) => item.id === id)
}

/** Zero-padded archive number, e.g. 7 -> "007". */
export function archiveNumber(index: number, pad = 3): string {
  const width = Math.max(1, pad)
  const ordinal = Math.max(0, Math.floor(index) + 1)
  return String(Math.max(1, ordinal)).padStart(width, '0')
}

/** "x 分钟前" style relative label; falls back to a date beyond a week. */
export function relativeTime(timestamp: number | undefined, now: number = Date.now()): string {
  if (!timestamp) return '从未'
  const delta = now - timestamp
  if (delta < 0) return '刚刚'
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚'
  if (delta < hour) return `${Math.floor(delta / minute)} 分钟前`
  if (delta < day) return `${Math.floor(delta / hour)} 小时前`
  if (delta < 7 * day) return `${Math.floor(delta / day)} 天前`
  const date = new Date(timestamp)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** Format a duration in ms as "12 小时 30 分". */
export function formatPlayTime(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '0 分'
  const totalMinutes = Math.floor(ms / 60_000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  if (hours <= 0) return `${Math.max(1, minutes)} 分`
  return minutes > 0 ? `${hours} 小时 ${minutes} 分` : `${hours} 小时`
}
