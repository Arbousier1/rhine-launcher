import { describe, expect, it } from 'vitest'
import type { JavaRuntime } from '@rhine/core'
import {
  archLabel, bestRuntime, componentForMajor, groupByMajor, JAVA_COMPONENTS, parseGameVersion,
  requiredJavaMajor, sortRuntimes, supportedGameVersions, summarizeRuntimes, validateJavaPath,
  vendorLabel,
} from '../src/features/java/java.ts'

function runtime(partial: Partial<JavaRuntime> & { path: string }): JavaRuntime {
  return {
    version: '17.0.9',
    majorVersion: 17,
    vendor: 'Eclipse Adoptium',
    arch: 'x64',
    managed: false,
    ...partial,
  }
}

describe('archLabel', () => {
  it('labels architectures in Chinese', () => {
    expect(archLabel('x64')).toBe('64 位')
    expect(archLabel('arm64')).toBe('ARM64')
    expect(archLabel('x86')).toBe('32 位')
    expect(archLabel('unknown')).toBe('未知架构')
  })
})

describe('sortRuntimes', () => {
  it('puts managed runtimes first and newest major before older ones', () => {
    const list = [
      runtime({ path: 'a', majorVersion: 17 }),
      runtime({ path: 'b', majorVersion: 21, managed: true }),
      runtime({ path: 'c', majorVersion: 21 }),
      runtime({ path: 'd', majorVersion: 8, managed: true }),
    ]
    expect(sortRuntimes(list).map((r) => r.path)).toEqual(['b', 'd', 'c', 'a'])
  })
})

describe('bestRuntime', () => {
  const list = [
    runtime({ path: 'sys17', majorVersion: 17 }),
    runtime({ path: 'managed17', majorVersion: 17, managed: true }),
    runtime({ path: 'sys21', majorVersion: 21 }),
    runtime({ path: 'old8', majorVersion: 8 }),
  ]

  it('honours the pinned path first', () => {
    expect(bestRuntime(list, 21, 'sys17')?.path).toBe('sys17')
  })

  it('prefers an exact match and the managed one among equals', () => {
    expect(bestRuntime(list, 17)?.path).toBe('managed17')
    expect(bestRuntime(list, 21)?.path).toBe('sys21')
  })

  it('falls back to the nearest newer runtime', () => {
    expect(bestRuntime(list, 16)?.path).toBe('managed17')
    expect(bestRuntime(list, 18)?.path).toBe('sys21')
  })

  it('returns undefined when nothing is new enough', () => {
    expect(bestRuntime([runtime({ path: 'old', majorVersion: 8 })], 21)).toBeUndefined()
    expect(bestRuntime([], 17)).toBeUndefined()
  })
})

describe('groupByMajor', () => {
  it('groups descending by major version', () => {
    const groups = groupByMajor([
      runtime({ path: 'a', majorVersion: 17 }),
      runtime({ path: 'b', majorVersion: 21 }),
      runtime({ path: 'c', majorVersion: 17 }),
    ])
    expect(groups.map((g) => g.major)).toEqual([21, 17])
    expect(groups[1].items).toHaveLength(2)
  })
})

describe('vendorLabel', () => {
  it('falls back for empty vendors', () => {
    expect(vendorLabel('  ')).toBe('未知厂商')
    expect(vendorLabel('Temurin')).toBe('Temurin')
  })
})

describe('validateJavaPath', () => {
  it('requires a full path with separators', () => {
    expect(validateJavaPath('')).toBe('请填写 java 可执行文件路径')
    expect(validateJavaPath('javaw.exe')).toContain('目录分隔符')
    expect(validateJavaPath('C:/Program Files/Java/bin/javaw.exe')).toBeUndefined()
    expect(validateJavaPath('C:\\Java\\bin\\javaw.exe')).toBeUndefined()
  })
})

describe('componentForMajor', () => {
  it('maps majors to Mojang components', () => {
    expect(componentForMajor(21)).toBe('java-runtime-gamma')
    expect(componentForMajor(17)).toBe('java-runtime-beta')
    expect(componentForMajor(8)).toBe('jre-legacy')
    expect(componentForMajor(25)).toBe('java-runtime-delta')
    expect(componentForMajor(26)).toBe('java-runtime-delta')
  })

  it('only lists components that exist upstream', () => {
    for (const item of JAVA_COMPONENTS) {
      expect(item.component).toMatch(/^(jre-legacy|java-runtime-\w+)$/)
    }
  })
})

describe('summarizeRuntimes', () => {
  it('counts totals, managed runtimes and distinct majors', () => {
    const summary = summarizeRuntimes([
      runtime({ path: 'a', majorVersion: 17, managed: true }),
      runtime({ path: 'b', majorVersion: 17 }),
      runtime({ path: 'c', majorVersion: 21 }),
    ])
    expect(summary).toEqual({ total: 3, managed: 1, majors: [21, 17] })
  })

  it('handles an empty list', () => {
    expect(summarizeRuntimes([])).toEqual({ total: 0, managed: 0, majors: [] })
  })
})
describe('requiredJavaMajor', () => {
  it('maps the modern 1.x line to the pinned runtimes', () => {
    expect(requiredJavaMajor('1.21.4')).toBe(21)
    expect(requiredJavaMajor('1.20.5')).toBe(21)
    expect(requiredJavaMajor('1.20.4')).toBe(17)
    expect(requiredJavaMajor('1.18')).toBe(17)
    expect(requiredJavaMajor('1.17.1')).toBe(16)
    expect(requiredJavaMajor('1.16.5')).toBe(8)
    expect(requiredJavaMajor('1.12.2')).toBe(8)
  })

  it('handles the 2026 numbering and unknown shapes', () => {
    expect(requiredJavaMajor('26.3')).toBe(25)
    expect(requiredJavaMajor('30.0')).toBe(25)
    expect(requiredJavaMajor('snapshot')).toBe(21)
    expect(requiredJavaMajor('')).toBe(21)
  })
})

describe('parseGameVersion', () => {
  it('folds the patch into the minor so comparisons work', () => {
    expect(parseGameVersion('1.20.1')).toEqual([1, 20.1])
    expect(parseGameVersion('1.20')).toEqual([1, 20])
    expect(parseGameVersion('26.3')).toEqual([26, 3])
    expect(parseGameVersion('nope')).toBeNull()
  })
})

describe('supportedGameVersions', () => {
  it('describes the span for each runtime line', () => {
    expect(supportedGameVersions(21)).toContain('1.20.5')
    expect(supportedGameVersions(8)).toContain('1.16.5')
    expect(supportedGameVersions(25)).toContain('1.21.9')
  })
})
