import { describe, expect, it } from 'vitest'
import type { LaunchSession, LogLine, TaskSnapshot } from '@rhine/core'
import {
  appendLines, countSevere, exitSummary, filterLines, filterTasks, formatLogTime,
  isSessionActive, progressLabel, sessionStatusLabel, sessionStatusTone, shouldStickToBottom,
  sortSessions, sortTasks, stageLabel, taskStatusLabel, taskStatusTone, upsertSession, upsertTask,
} from '../src/features/logs/logs.ts'

function task(partial: Partial<TaskSnapshot> & { id: string }): TaskSnapshot {
  return {
    kind: 'install',
    title: '安装',
    status: 'running',
    progress: { value: 0.5, stage: 'download', current: 5, total: 10 },
    logs: [],
    createdAt: 100,
    ...partial,
  }
}

function session(partial: Partial<LaunchSession> & { id: string }): LaunchSession {
  return {
    instanceId: 'i1',
    accountName: 'Erin',
    startedAt: 100,
    status: 'running',
    command: ['java'],
    logFile: '/logs/a.log',
    ...partial,
  }
}

function line(level: LogLine['level'], message: string, time = 0): LogLine {
  return { time, level, message }
}

describe('task labels', () => {
  it('renders Chinese status labels and tones', () => {
    expect(taskStatusLabel('running')).toBe('进行中')
    expect(taskStatusLabel('failed')).toBe('失败')
    expect(taskStatusTone('running')).toBe('accent')
    expect(taskStatusTone('succeeded')).toBe('ok')
    expect(taskStatusTone('failed')).toBe('danger')
    expect(taskStatusTone('queued')).toBe('muted')
  })
})

describe('session labels', () => {
  it('renders Chinese status labels and tones', () => {
    expect(sessionStatusLabel('starting')).toBe('启动中')
    expect(sessionStatusLabel('crashed')).toBe('崩溃')
    expect(sessionStatusTone('running')).toBe('ok')
    expect(sessionStatusTone('crashed')).toBe('danger')
  })

  it('detects live sessions', () => {
    expect(isSessionActive(session({ id: 'a', status: 'running' }))).toBe(true)
    expect(isSessionActive(session({ id: 'b', status: 'starting' }))).toBe(true)
    expect(isSessionActive(session({ id: 'c', status: 'exited' }))).toBe(false)
  })
})

describe('sortTasks', () => {
  it('orders running before queued before finished, newest first inside a group', () => {
    const tasks = [
      task({ id: 's', status: 'succeeded', createdAt: 500 }),
      task({ id: 'r1', status: 'running', createdAt: 100 }),
      task({ id: 'q', status: 'queued', createdAt: 200 }),
      task({ id: 'r2', status: 'running', createdAt: 300 }),
    ]
    expect(sortTasks(tasks).map((t) => t.id)).toEqual(['r2', 'r1', 'q', 's'])
  })

  it('does not mutate the input', () => {
    const input = [task({ id: 'a' }), task({ id: 'b', status: 'succeeded' })]
    sortTasks(input)
    expect(input[0].id).toBe('a')
  })
})

describe('sortSessions', () => {
  it('keeps active sessions first and newest first inside a group', () => {
    const sessions = [
      session({ id: 'old', status: 'exited', startedAt: 100 }),
      session({ id: 'live', status: 'running', startedAt: 50 }),
      session({ id: 'new', status: 'exited', startedAt: 300 }),
    ]
    expect(sortSessions(sessions).map((s) => s.id)).toEqual(['live', 'new', 'old'])
  })
})

describe('filterTasks', () => {
  const tasks = [
    task({ id: 'a', title: '安装 Fabric', kind: 'loader' }),
    task({ id: 'b', title: '下载 Java', status: 'failed', error: '网络超时', kind: 'java' }),
  ]

  it('filters by query across title, kind and error', () => {
    expect(filterTasks(tasks, 'fabric').map((t) => t.id)).toEqual(['a'])
    expect(filterTasks(tasks, '超时').map((t) => t.id)).toEqual(['b'])
    expect(filterTasks(tasks, '').map((t) => t.id)).toEqual(['a', 'b'])
  })

  it('filters by status', () => {
    expect(filterTasks(tasks, '', 'failed').map((t) => t.id)).toEqual(['b'])
  })
})

describe('progressLabel', () => {
  it('renders stage, counters and percentage', () => {
    expect(progressLabel({ value: 0.5, stage: 'download', current: 5, total: 10 }))
      .toBe('下载 5/10（50%）')
    expect(progressLabel({ value: -1, stage: 'resolve' })).toBe('解析元数据')
    expect(progressLabel({ value: 0.25, stage: 'download' })).toBe('下载 25%')
    expect(progressLabel({ value: -1, stage: 'download', message: '连接中' })).toBe('连接中')
    expect(progressLabel(undefined)).toBe('准备中')
  })

  it('labels every stage in Chinese', () => {
    expect(stageLabel('resolve')).toBe('解析元数据')
    expect(stageLabel('verify')).toBe('校验')
    expect(stageLabel('extract')).toBe('解压')
    expect(stageLabel('write')).toBe('写入')
    expect(stageLabel('done')).toBe('完成')
  })
})

describe('filterLines', () => {
  const lines = [
    line('debug', 'verbose'),
    line('info', 'Starting game'),
    line('warn', 'Missing texture'),
    line('error', 'Crashed'),
  ]

  it('keeps everything for all', () => {
    expect(filterLines(lines, 'all')).toHaveLength(4)
  })

  it('drops debug for info but keeps warn and error', () => {
    expect(filterLines(lines, 'info').map((l) => l.message)).toEqual(['Starting game', 'Missing texture', 'Crashed'])
  })

  it('keeps warn and error for warn and error only', () => {
    expect(filterLines(lines, 'warn').map((l) => l.level)).toEqual(['warn', 'error'])
    expect(filterLines(lines, 'error').map((l) => l.level)).toEqual(['error'])
  })

  it('matches the search query case-insensitively', () => {
    expect(filterLines(lines, 'all', 'crash').map((l) => l.message)).toEqual(['Crashed'])
  })
})

describe('formatLogTime', () => {
  it('renders a fixed width clock', () => {
    const time = new Date(2026, 0, 2, 3, 4, 5).getTime()
    expect(formatLogTime(time)).toBe('03:04:05')
    expect(formatLogTime(Number.NaN)).toBe('--:--:--')
  })
})

describe('appendLines', () => {
  it('appends and caps the buffer at the newest lines', () => {
    const existing = [line('info', 'a'), line('info', 'b')]
    expect(appendLines(existing, [line('info', 'c')]).map((l) => l.message)).toEqual(['a', 'b', 'c'])
    expect(appendLines(existing, [line('info', 'c')], 2).map((l) => l.message)).toEqual(['b', 'c'])
  })

  it('returns the same array when nothing arrives', () => {
    const existing = [line('info', 'a')]
    expect(appendLines(existing, [])).toBe(existing)
  })
})

describe('countSevere', () => {
  it('counts warnings and errors', () => {
    expect(countSevere([line('warn', 'w'), line('error', 'e'), line('error', 'e2'), line('info', 'i')]))
      .toEqual({ warn: 1, error: 2 })
  })
})

describe('upsertTask / upsertSession', () => {
  it('replaces an existing entry in place', () => {
    const tasks = [task({ id: 'a' }), task({ id: 'b' })]
    const next = upsertTask(tasks, task({ id: 'a', title: '更新' }))
    expect(next.map((t) => t.title)).toEqual(['更新', '安装'])
    expect(tasks[0].title).toBe('安装')
  })

  it('prepends unknown entries', () => {
    expect(upsertTask([task({ id: 'a' })], task({ id: 'b' })).map((t) => t.id)).toEqual(['b', 'a'])
    expect(upsertSession([session({ id: 'a' })], session({ id: 'b' })).map((s) => s.id)).toEqual(['b', 'a'])
  })
})

describe('shouldStickToBottom', () => {
  it('sticks when close to the bottom', () => {
    expect(shouldStickToBottom(null)).toBe(true)
    expect(shouldStickToBottom({ scrollTop: 900, scrollHeight: 1000, clientHeight: 100 })).toBe(true)
    expect(shouldStickToBottom({ scrollTop: 100, scrollHeight: 1000, clientHeight: 100 })).toBe(false)
  })
})

describe('exitSummary', () => {
  it('describes the exit state in Chinese', () => {
    expect(exitSummary(session({ id: 'a', status: 'running' }))).toBe('运行中')
    expect(exitSummary(session({ id: 'b', status: 'exited', exitCode: 0 }))).toBe('正常退出')
    expect(exitSummary(session({ id: 'c', status: 'crashed', exitCode: 1 }))).toBe('退出码 1')
    expect(exitSummary(session({ id: 'd', status: 'stopped' }))).toBe('已终止')
  })
})
