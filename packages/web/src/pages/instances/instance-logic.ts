/**
 * Pure helpers for the instance detail view.
 *
 * Kept out of the page component so they can be unit tested without a DOM or a
 * bundler step for CSS imports.
 */
import type { LogLine, LoaderSpec } from '@rhine/core'

/**
 * Split a space separated argument string, honouring double quotes and
 * backslash escapes. Mirrors how the backend tokenises jvmArgs / gameArgs.
 */
export function splitArgs(value: string): string[] {
  const out: string[] = []
  let current = ''
  let quoted = false
  let escaped = false
  let hasToken = false

  for (const char of value) {
    if (escaped) {
      current += char
      hasToken = true
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = true
      continue
    }
    if (char === '"') {
      quoted = !quoted
      hasToken = true
      continue
    }
    if (!quoted && (char === ' ' || char === '\t' || char === '\n' || char === '\r')) {
      if (hasToken) {
        out.push(current)
        current = ''
        hasToken = false
      }
      continue
    }
    current += char
    hasToken = true
  }
  if (hasToken) out.push(current)
  return out
}

/** CSS class for one log line, chosen from the level markers it contains. */
export function logLineClass(line: string): string {
  const upper = line.toUpperCase()
  if (upper.includes('/ERROR') || upper.includes('/FATAL') || upper.includes('EXCEPTION')) {
    return 'rh-detail__logline rh-detail__logline--error'
  }
  if (upper.includes('/WARN')) return 'rh-detail__logline rh-detail__logline--warn'
  return 'rh-detail__logline'
}

/** Format one backend log line as `[HH:MM:SS.mmm] [LEVEL] message`. */
export function formatLogLine(line: LogLine): string {
  const date = new Date(line.time)
  const time = Number.isNaN(date.getTime()) ? '--:--:--.---' : date.toISOString().slice(11, 23)
  return '[' + time + '] [' + line.level.toUpperCase() + '] ' + line.message
}

/** Keep only the last `limit` lines of a log blob. */
export function tailLines(text: string, limit: number): string[] {
  if (!text) return []
  const lines = text.split(String.fromCharCode(10))
  return limit > 0 ? lines.slice(-limit) : lines
}

/**
 * Short loader description used in detail headers, e.g. "Fabric 0.16.9".
 * Returns the vanilla label when no loader is attached.
 */
export function describeLoaders(loaders: LoaderSpec[] | undefined): string {
  if (!loaders || loaders.length === 0) return '原版'
  return loaders
    .filter((loader) => loader.kind !== 'vanilla')
    .map((loader) => (loader.version ? loader.kind + ' ' + loader.version : loader.kind))
    .join(' + ') || '原版'
}
