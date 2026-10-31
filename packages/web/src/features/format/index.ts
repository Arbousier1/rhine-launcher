/**
 * Presentation-only formatting helpers shared by every feature page.
 *
 * All functions are pure and locale-stable (zh-CN) so they can be unit tested
 * without a DOM. Sizes use binary units because Minecraft files are usually
 * counted that way by launchers such as HMCL.
 */

const SIZE_UNITS = ['B', 'KB', 'MB', 'GB', 'TB'] as const

/**
 * Format a byte count with adaptive binary units.
 *
 * @param bytes — raw byte count; negative or non-finite input renders as a dash.
 * @param digits — maximum fraction digits for units above bytes.
 * @returns a short label such as `1.2 MB`.
 */
export function formatBytes(bytes: number, digits = 1): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < 1024) return bytes + ' B'
  let value = bytes
  let unit = 0
  while (value >= 1024 && unit < SIZE_UNITS.length - 1) {
    value /= 1024
    unit += 1
  }
  const text = value.toFixed(digits).replace(/\.0+$/, '')
  return text + ' ' + SIZE_UNITS[unit]
}

/**
 * Format a large counter (downloads, follows) the way HMCL shows popularity.
 *
 * @param value — raw count.
 * @returns e.g. `12.3 万`, `1.2 亿`, or the plain number under 10k.
 */
export function formatCount(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 10_000) return String(Math.round(value))
  if (value < 100_000_000) return trimZero(value / 10_000) + ' 万'
  return trimZero(value / 100_000_000) + ' 亿'
}

function trimZero(value: number): string {
  const digits = value >= 100 ? 0 : 1
  return value.toFixed(digits).replace(/\.0+$/, '')
}

/**
 * Format a timestamp as a relative age, matching the launcher's compact tone.
 *
 * @param time — epoch milliseconds.
 * @param now — reference time (injectable for tests).
 * @returns `刚刚` / `3 分钟前` / `2 天前` / an absolute date beyond 30 days.
 */
export function formatRelativeTime(time: number | string | undefined, now = Date.now()): string {
  const stamp = typeof time === 'string' ? Date.parse(time) : time
  if (stamp === undefined || !Number.isFinite(stamp)) return '—'
  const delta = now - stamp
  if (delta < 0) return formatDate(stamp)
  const minute = 60_000
  const hour = 60 * minute
  const day = 24 * hour
  if (delta < minute) return '刚刚'
  if (delta < hour) return Math.floor(delta / minute) + ' 分钟前'
  if (delta < day) return Math.floor(delta / hour) + ' 小时前'
  if (delta < 30 * day) return Math.floor(delta / day) + ' 天前'
  return formatDate(stamp)
}

/**
 * Format an epoch timestamp as `YYYY-MM-DD` in local time.
 *
 * @param time — epoch milliseconds.
 * @returns a dash when the input is invalid.
 */
export function formatDate(time: number): string {
  if (!Number.isFinite(time)) return '—'
  const date = new Date(time)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return date.getFullYear() + '-' + month + '-' + day
}

/**
 * Format a duration in milliseconds as a compact play time.
 *
 * @param ms — elapsed milliseconds.
 * @returns `< 1 分钟` / `12 分钟` / `3 小时 5 分钟`.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const minutes = Math.floor(ms / 60_000)
  if (minutes < 1) return '< 1 分钟'
  if (minutes < 60) return minutes + ' 分钟'
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? hours + ' 小时 ' + rest + ' 分钟' : hours + ' 小时'
}

/**
 * Clamp a 0..1 ratio and turn it into a whole percentage.
 *
 * @param value — ratio; `-1` (unknown total) yields `null`.
 * @returns 0..100, or `null` when the progress is indeterminate.
 */
export function toPercent(value: number): number | null {
  if (!Number.isFinite(value) || value < 0) return null
  return Math.min(100, Math.max(0, Math.round(value * 100)))
}

/**
 * Shorten a long path for display while keeping both ends readable.
 *
 * @param path — absolute or relative path.
 * @param max — maximum characters before truncating.
 */
export function shortenPath(path: string, max = 56): string {
  if (!path) return ''
  if (path.length <= max) return path
  const keep = Math.floor((max - 1) / 2)
  return path.slice(0, keep) + '…' + path.slice(path.length - keep)
}

/**
 * Uppercase latin tokens of a label, used for the small English captions.
 *
 * @param text — source label such as `Mods`.
 */
export function caption(text: string): string {
  return text.toUpperCase()
}
