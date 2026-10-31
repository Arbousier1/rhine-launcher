/**
 * Pure helpers for the task + log page.
 *
 * Everything here is about ordering, filtering and summarising already-fetched
 * snapshots, which keeps the live-log component simple and testable.
 */
import type { LaunchSession, LogLine, Progress, TaskSnapshot, TaskStatus } from '@rhine/core'

/** Status ordering used when sorting the task list (active work first). */
const STATUS_WEIGHT: Record<TaskStatus, number> = {
  running: 0,
  queued: 1,
  failed: 2,
  cancelled: 3,
  succeeded: 4,
}

/** Chinese label for a task status. */
export function taskStatusLabel(status: TaskStatus): string {
  switch (status) {
    case 'queued': return '排队中'
    case 'running': return '进行中'
    case 'succeeded': return '已完成'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    default: return status
  }
}

/** Badge tone for a task status. */
export function taskStatusTone(status: TaskStatus): 'accent' | 'ok' | 'warn' | 'danger' | 'muted' {
  switch (status) {
    case 'queued': return 'muted'
    case 'running': return 'accent'
    case 'succeeded': return 'ok'
    case 'failed': return 'danger'
    case 'cancelled': return 'warn'
    default: return 'muted'
  }
}

/** Chinese label for a session status. */
export function sessionStatusLabel(status: LaunchSession['status']): string {
  switch (status) {
    case 'starting': return '启动中'
    case 'running': return '运行中'
    case 'exited': return '已退出'
    case 'crashed': return '崩溃'
    case 'stopped': return '已终止'
    default: return status
  }
}

/** Badge tone for a session status. */
export function sessionStatusTone(status: LaunchSession['status']): 'accent' | 'ok' | 'warn' | 'danger' | 'muted' {
  switch (status) {
    case 'starting': return 'accent'
    case 'running': return 'ok'
    case 'exited': return 'muted'
    case 'crashed': return 'danger'
    case 'stopped': return 'warn'
    default: return 'muted'
  }
}

/** True when a session is still alive. */
export function isSessionActive(session: LaunchSession): boolean {
  return session.status === 'starting' || session.status === 'running'
}

/** Sort tasks: active first, then by creation time descending. */
export function sortTasks(tasks: TaskSnapshot[]): TaskSnapshot[] {
  return [...tasks].sort((a, b) => {
    const weight = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status]
    if (weight !== 0) return weight
    return b.createdAt - a.createdAt
  })
}

/** Sort sessions: active first, then newest first. */
export function sortSessions(sessions: LaunchSession[]): LaunchSession[] {
  return [...sessions].sort((a, b) => {
    const activeA = isSessionActive(a) ? 0 : 1
    const activeB = isSessionActive(b) ? 0 : 1
    if (activeA !== activeB) return activeA - activeB
    return b.startedAt - a.startedAt
  })
}

/** Filter the task list by a free-text query and an optional status. */
export function filterTasks(tasks: TaskSnapshot[], query: string, status?: TaskStatus): TaskSnapshot[] {
  const needle = query.trim().toLowerCase()
  return tasks.filter((task) => {
    if (status && task.status !== status) return false
    if (!needle) return true
    return (task.title + '\u0000' + task.kind + '\u0000' + (task.error ?? ''))
      .toLowerCase()
      .includes(needle)
  })
}

/** Progress label shown on the task row. */
export function progressLabel(progress: Progress | undefined): string {
  if (!progress) return '准备中'
  if (progress.value < 0) {
    return progress.message || stageLabel(progress.stage)
  }
  const percent = Math.round(Math.min(1, Math.max(0, progress.value)) * 100)
  const base = progress.message || stageLabel(progress.stage)
  if (progress.total > 0) return base + ' ' + progress.current + '/' + progress.total + '（' + percent + '%）'
  return base + ' ' + percent + '%'
}

/** Chinese stage names matching ProgressStage. */
export function stageLabel(stage: Progress['stage']): string {
  switch (stage) {
    case 'resolve': return '解析元数据'
    case 'download': return '下载'
    case 'verify': return '校验'
    case 'extract': return '解压'
    case 'write': return '写入'
    case 'done': return '完成'
    default: return stage
  }
}

/** Options for the log level filter. */
export type LogLevelFilter = 'all' | 'info' | 'warn' | 'error'

/**
 * Filter log lines by level.
 *
 * `info` also keeps warnings and errors because hiding them would make the
 * filter useless during crash triage.
 */
export function filterLines(lines: LogLine[], level: LogLevelFilter, query = ''): LogLine[] {
  const needle = query.trim().toLowerCase()
  return lines.filter((line) => {
    if (level === 'warn' && line.level !== 'warn' && line.level !== 'error') return false
    if (level === 'error' && line.level !== 'error') return false
    if (level === 'info' && line.level === 'debug') return false
    if (!needle) return true
    return line.message.toLowerCase().includes(needle)
  })
}

/** Clock label for a log line. */
export function formatLogTime(time: number): string {
  if (!Number.isFinite(time)) return '--:--:--'
  const date = new Date(time)
  const pad = (value: number) => String(value).padStart(2, '0')
  return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
}

/**
 * Append a batch of lines to an existing buffer with a hard cap.
 *
 * Live logs are unbounded; keeping the newest `limit` lines bounds memory for
 * long play sessions without losing the tail that matters.
 */
export function appendLines(existing: LogLine[], incoming: LogLine[], limit = 4000): LogLine[] {
  if (!incoming.length) return existing
  const merged = existing.concat(incoming)
  if (merged.length <= limit) return merged
  return merged.slice(merged.length - limit)
}

/** Count of error/warn lines, shown as a badge on the log panel. */
export function countSevere(lines: LogLine[]): { warn: number; error: number } {
  let warn = 0
  let error = 0
  for (const line of lines) {
    if (line.level === 'error') error += 1
    else if (line.level === 'warn') warn += 1
  }
  return { warn, error }
}

/** Merge a task snapshot into a list by id, keeping order stable. */
export function upsertTask(tasks: TaskSnapshot[], next: TaskSnapshot): TaskSnapshot[] {
  const index = tasks.findIndex((task) => task.id === next.id)
  if (index === -1) return [next, ...tasks]
  const copy = [...tasks]
  copy[index] = next
  return copy
}

/** Merge a session snapshot into a list by id. */
export function upsertSession(sessions: LaunchSession[], next: LaunchSession): LaunchSession[] {
  const index = sessions.findIndex((session) => session.id === next.id)
  if (index === -1) return [next, ...sessions]
  const copy = [...sessions]
  copy[index] = next
  return copy
}

/**
 * Decide whether the log view should stick to the bottom.
 *
 * The user pauses autoscroll by scrolling up; we only resume automatically and
 * only when they are within a small threshold of the bottom.
 */
export function shouldStickToBottom(
  element: { scrollTop: number; scrollHeight: number; clientHeight: number } | null,
  threshold = 24,
): boolean {
  if (!element) return true
  return element.scrollHeight - element.scrollTop - element.clientHeight <= threshold
}

/** Human summary of an exit code for the session row. */
export function exitSummary(session: LaunchSession): string {
  if (session.status === 'running' || session.status === 'starting') return '运行中'
  if (session.exitCode === undefined || session.exitCode === null) return sessionStatusLabel(session.status)
  if (session.exitCode === 0) return '正常退出'
  return '退出码 ' + session.exitCode
}
