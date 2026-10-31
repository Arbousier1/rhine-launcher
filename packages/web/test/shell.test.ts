/**
 * Unit tests for the shell's pure helpers: i18n, grid movement utilities and
 * the instance detail argument/log formatting.
 */
import { describe, expect, it } from 'vitest'
import {
  LOCALES, LOCALE_LABELS, createTranslator, dictionaryKeys, fallbackLocale,
  interpolate, normalizeLocale,
} from '../src/app/i18n.ts'
import {
  archiveNumber, clampIndex, formatPlayTime, indexOfId, moveInGrid, relativeTime, wrapIndex,
} from '../src/ui/grid-nav.ts'
import {
  describeLoaders, formatLogLine, logLineClass, splitArgs, tailLines,
} from '../src/pages/instances/instance-logic.ts'
import { LAUNCH_STAGES, overallProgress, stageFraction, stageIndex, stageState } from '../src/boot/launch-stages.ts'

describe('i18n', () => {
  it('exposes both locales with labels', () => {
    expect(LOCALES).toEqual(['zh-CN', 'en-US'])
    expect(LOCALE_LABELS['zh-CN']).toBe('中文')
    expect(LOCALE_LABELS['en-US']).toBe('English')
  })

  it('translates and interpolates', () => {
    const t = createTranslator('zh-CN')
    expect(t('archive.title')).toBe('档案库')
    expect(t('archive.count', { count: 7 })).toBe('共 7 份档案')
    expect(createTranslator('en-US')('archive.count', { count: 2 })).toBe('2 archives')
  })

  it('returns the key when a translation is missing', () => {
    const t = createTranslator('zh-CN')
    expect(t('does.not.exist')).toBe('does.not.exist')
  })

  it('leaves unknown placeholders untouched', () => {
    expect(interpolate('hello {name}', { other: 'x' })).toBe('hello {name}')
    expect(interpolate('no placeholders', { name: 'x' })).toBe('no placeholders')
    expect(interpolate('{a} + {b}', { a: 1, b: 2 })).toBe('1 + 2')
  })

  it('is safe without params', () => {
    expect(interpolate('plain')).toBe('plain')
  })

  it('keeps both dictionaries in sync', () => {
    const zh = dictionaryKeys('zh-CN').slice().sort()
    const en = dictionaryKeys('en-US').slice().sort()
    expect(en).toEqual(zh)
    expect(zh.length).toBeGreaterThan(100)
  })

  it('falls back to zh-CN', () => {
    expect(fallbackLocale('en-US')).toBe('zh-CN')
  })

  it('normalises arbitrary locale tags', () => {
    expect(normalizeLocale('en')).toBe('en-US')
    expect(normalizeLocale('en-GB')).toBe('en-US')
    expect(normalizeLocale('zh-TW')).toBe('zh-CN')
    expect(normalizeLocale('fr-FR')).toBe('zh-CN')
    expect(normalizeLocale(null)).toBe('zh-CN')
    expect(normalizeLocale(undefined)).toBe('zh-CN')
  })

  it('does not fall back to English when zh-CN is requested', () => {
    const t = createTranslator('zh-CN')
    expect(t('nav.archive')).toBe('档案库')
  })
})

describe('grid-nav', () => {
  it('clamps indices', () => {
    expect(clampIndex(-5, 3)).toBe(0)
    expect(clampIndex(7, 3)).toBe(2)
    expect(clampIndex(1, 3)).toBe(1)
    expect(clampIndex(0, 0)).toBe(-1)
  })

  it('wraps indices', () => {
    expect(wrapIndex(-1, 3)).toBe(2)
    expect(wrapIndex(3, 3)).toBe(0)
    expect(wrapIndex(1, 3)).toBe(1)
    expect(wrapIndex(0, 0)).toBe(-1)
  })

  it('moves inside the grid without wrapping', () => {
    expect(moveInGrid(0, 1, 4)).toBe(1)
    expect(moveInGrid(0, -1, 4)).toBe(0)
    expect(moveInGrid(3, 1, 4)).toBe(3)
  })

  it('finds items by id', () => {
    const items = [{ id: 'a' }, { id: 'b' }]
    expect(indexOfId(items, 'b')).toBe(1)
    expect(indexOfId(items, 'z')).toBe(-1)
    expect(indexOfId(items, null)).toBe(-1)
    expect(indexOfId(items, undefined)).toBe(-1)
  })

  it('pads archive numbers', () => {
    expect(archiveNumber(0)).toBe('001')
    expect(archiveNumber(9)).toBe('010')
    expect(archiveNumber(41, 4)).toBe('0042')
    expect(archiveNumber(-3)).toBe('001')
  })

  it('formats relative time', () => {
    const now = 1_700_000_000_000
    expect(relativeTime(undefined, now)).toBe('从未')
    expect(relativeTime(now - 30_000, now)).toBe('刚刚')
    expect(relativeTime(now - 5 * 60_000, now)).toBe('5 分钟前')
    expect(relativeTime(now - 3 * 3_600_000, now)).toBe('3 小时前')
    expect(relativeTime(now - 2 * 86_400_000, now)).toBe('2 天前')
    expect(relativeTime(now - 30 * 86_400_000, now)).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    expect(relativeTime(now + 10_000, now)).toBe('刚刚')
  })

  it('formats play time', () => {
    expect(formatPlayTime(0)).toBe('0 分')
    expect(formatPlayTime(-1)).toBe('0 分')
    expect(formatPlayTime(90_000)).toBe('1 分')
    expect(formatPlayTime(120_000)).toBe('2 分')
    expect(formatPlayTime(30_000)).toBe('1 分')
    expect(formatPlayTime(3_600_000)).toBe('1 小时')
    expect(formatPlayTime(3_600_000 + 30 * 60_000)).toBe('1 小时 30 分')
    expect(formatPlayTime(Number.NaN)).toBe('0 分')
  })
})

describe('instance-logic', () => {
  it('splits plain arguments', () => {
    expect(splitArgs('')).toEqual([])
    expect(splitArgs('-Xmx4G -Xms1G')).toEqual(['-Xmx4G', '-Xms1G'])
    expect(splitArgs('  a   b  ')).toEqual(['a', 'b'])
  })

  it('keeps quoted arguments together', () => {
    expect(splitArgs('-Dfoo="a b" -Dbar=c')).toEqual(['-Dfoo=a b', '-Dbar=c'])
    expect(splitArgs('"--a=1 --b=2"')).toEqual(['--a=1 --b=2'])
  })

  it('honours backslash escapes', () => {
    expect(splitArgs('a\\ b')).toEqual(['a b'])
  })

  it('classifies log lines', () => {
    expect(logLineClass('[12:00:00] [main/ERROR]: boom')).toContain('error')
    expect(logLineClass('[12:00:00] [main/FATAL]: boom')).toContain('error')
    expect(logLineClass('java.lang.RuntimeException: x')).toContain('error')
    expect(logLineClass('[12:00:00] [main/WARN]: careful')).toContain('warn')
    expect(logLineClass('[12:00:00] [main/INFO]: fine')).toBe('rh-detail__logline')
  })

  it('formats a log line', () => {
    const time = Date.UTC(2026, 0, 2, 3, 4, 5, 6)
    expect(formatLogLine({ time, level: 'info', message: 'hi' })).toBe('[03:04:05.006] [INFO] hi')
  })

  it('tails log text', () => {
    const newline = String.fromCharCode(10)
    const text = ['a', 'b', 'c', 'd'].join(newline)
    expect(tailLines(text, 2)).toEqual(['c', 'd'])
    expect(tailLines(text, 0)).toEqual(['a', 'b', 'c', 'd'])
    expect(tailLines('', 10)).toEqual([])
  })

  it('describes loaders', () => {
    expect(describeLoaders(undefined)).toBe('原版')
    expect(describeLoaders([])).toBe('原版')
    expect(describeLoaders([{ kind: 'vanilla' }])).toBe('原版')
    expect(describeLoaders([{ kind: 'fabric', version: '0.16.9' }])).toBe('fabric 0.16.9')
    expect(describeLoaders([{ kind: 'forge', version: '20.4' }, { kind: 'optifine', version: 'I6' }])).toBe(
      'forge 20.4 + optifine I6',
    )
  })
})

describe('launch overlay stages', () => {
  it('has five ordered stages', () => {
    expect(LAUNCH_STAGES).toEqual(['prepare', 'verify', 'java', 'spawn', 'running'])
  })

  it('maps a stage to its index', () => {
    expect(stageIndex('prepare')).toBe(0)
    expect(stageIndex('running')).toBe(4)
  })

  it('treats unknown stages as the first one', () => {
    expect(stageIndex('nope' as never)).toBe(0)
  })

  it('computes the stage fraction', () => {
    expect(stageFraction('prepare', 'running')).toBe(0)
    expect(stageFraction('spawn', 'running')).toBe(0.6)
    expect(stageFraction('prepare', 'done')).toBe(1)
    expect(stageFraction('running', 'failed')).toBe(0.8)
  })

  it('resolves each row state', () => {
    expect(stageState('prepare', 'spawn', 'running')).toBe('done')
    expect(stageState('spawn', 'spawn', 'running')).toBe('active')
    expect(stageState('running', 'spawn', 'running')).toBe('idle')
    expect(stageState('spawn', 'spawn', 'failed')).toBe('failed')
    expect(stageState('java', 'spawn', 'failed')).toBe('done')
    expect(stageState('running', 'spawn', 'done')).toBe('done')
  })

  it('prefers a real progress value over the stage ramp', () => {
    expect(overallProgress(0.42, 'prepare', 'running')).toBe(0.42)
    expect(overallProgress(1.4, 'prepare', 'running')).toBe(1)
    expect(overallProgress(undefined, 'spawn', 'running')).toBe(0.6)
    expect(overallProgress(-1, 'spawn', 'running')).toBe(0.6)
  })
})
