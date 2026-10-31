import { describe, expect, it } from 'vitest'
import {
  caption, formatBytes, formatCount, formatDate, formatDuration, formatRelativeTime,
  shortenPath, toPercent,
} from '../src/features/format/index.ts'

describe('formatBytes', () => {
  it('uses binary units and strips trailing zeros', () => {
    expect(formatBytes(0)).toBe('0 B')
    expect(formatBytes(512)).toBe('512 B')
    expect(formatBytes(1024)).toBe('1 KB')
    expect(formatBytes(1536)).toBe('1.5 KB')
    expect(formatBytes(1024 * 1024)).toBe('1 MB')
    expect(formatBytes(3.25 * 1024 * 1024 * 1024)).toBe('3.3 GB')
  })

  it('renders a dash for invalid input', () => {
    expect(formatBytes(-1)).toBe('—')
    expect(formatBytes(Number.NaN)).toBe('—')
  })
})

describe('formatCount', () => {
  it('compacts counts above ten thousand', () => {
    expect(formatCount(9_999)).toBe('9999')
    expect(formatCount(12_345)).toBe('1.2 万')
    expect(formatCount(123_456)).toBe('12.3 万')
    expect(formatCount(12_345_678)).toBe('1235 万')
    expect(formatCount(123_456_789)).toBe('1.2 亿')
  })

  it('renders a dash for invalid input', () => {
    expect(formatCount(-5)).toBe('—')
  })
})

describe('formatRelativeTime', () => {
  const now = Date.parse('2026-01-10T12:00:00Z')

  it('describes recent timestamps', () => {
    expect(formatRelativeTime(now - 10_000, now)).toBe('刚刚')
    expect(formatRelativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(formatRelativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(formatRelativeTime(now - 2 * 86_400_000, now)).toBe('2 天前')
  })

  it('falls back to an absolute date beyond 30 days', () => {
    expect(formatRelativeTime(now - 40 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
  })

  it('accepts ISO strings and rejects garbage', () => {
    expect(formatRelativeTime('2026-01-10T11:59:00Z', now)).toBe('1 分钟前')
    expect(formatRelativeTime(undefined, now)).toBe('—')
    expect(formatRelativeTime('not-a-date', now)).toBe('—')
  })
})

describe('formatDate', () => {
  it('pads month and day', () => {
    expect(formatDate(Date.parse('2026-03-04T00:00:00'))).toBe('2026-03-04')
    expect(formatDate(Number.NaN)).toBe('—')
  })
})

describe('formatDuration', () => {
  it('renders minutes and hours', () => {
    expect(formatDuration(0)).toBe('—')
    expect(formatDuration(30_000)).toBe('< 1 分钟')
    expect(formatDuration(12 * 60_000)).toBe('12 分钟')
    expect(formatDuration(185 * 60_000)).toBe('3 小时 5 分钟')
    expect(formatDuration(180 * 60_000)).toBe('3 小时')
  })
})

describe('toPercent', () => {
  it('clamps and rounds', () => {
    expect(toPercent(0)).toBe(0)
    expect(toPercent(0.456)).toBe(46)
    expect(toPercent(1.4)).toBe(100)
    expect(toPercent(-1)).toBeNull()
  })
})

describe('shortenPath', () => {
  it('keeps both ends of a long path', () => {
    expect(shortenPath('C:/a/b', 10)).toBe('C:/a/b')
    const long = shortenPath('C:/very/long/path/to/some/deep/directory/file.jar', 20)
    expect(long).toContain('…')
    expect(long.length).toBeLessThanOrEqual(20)
  })

  it('handles empty input', () => {
    expect(shortenPath('')).toBe('')
  })
})

describe('caption', () => {
  it('uppercases latin labels', () => {
    expect(caption('mods')).toBe('MODS')
  })
})
