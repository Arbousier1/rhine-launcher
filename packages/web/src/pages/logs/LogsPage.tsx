/**
 * Tasks & logs page.
 *
 * Three stacked sections: running/finished tasks with live progress, launch
 * sessions, and the log tail of the selected session. Log lines arrive over
 * the WebSocket and are buffered in `useLaunchStore`; the panel follows the
 * tail unless the user scrolls up (which latches the pause state).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { LaunchSession, LogLine, TaskSnapshot, TaskStatus } from '@rhine/core'
import { api } from '@/api/client'
import {
  Badge, Button, EmptyState, Input, Panel, Progress, Select, StatusDot, Tabs, Tooltip, toast,
} from '@/ui'
import { SearchIcon, TerminalIcon } from '@/ui/icons'
import { PageHead } from '@/features/common/PageHead'
import { Placeholder, StatStrip } from '@/features/common/toolbar'
import { formatRelativeTime } from '@/features/format/index.ts'
import {
  countSevere, exitSummary, filterLines, filterTasks, formatLogTime,
  isSessionActive, progressLabel, sessionStatusLabel, sessionStatusTone, shouldStickToBottom,
  sortSessions, sortTasks, taskStatusLabel, taskStatusTone, type LogLevelFilter,
} from '@/features/logs/logs.ts'
import {
  attachLaunchLogStream, currentNotices, subscribeNotices, useAppStore, useLaunchStore,
  type ServerNotice,
} from '@/stores'
import page from '@/features/common/page.module.css'
import styles from './logs.module.css'

export default function LogsPage() {
  const tasks = useAppStore((state) => state.tasks)
  const sessions = useAppStore((state) => state.sessions)
  const reload = useAppStore((state) => state.reload)
  const notices = useServerNotices()

  const logs = useLaunchStore((state) => state.logs)
  const activeSessionId = useLaunchStore((state) => state.activeSessionId)
  const paused = useLaunchStore((state) => state.paused)
  const setActive = useLaunchStore((state) => state.setActive)
  const setPaused = useLaunchStore((state) => state.setPaused)
  const setAll = useLaunchStore((state) => state.setAll)

  const [tab, setTab] = useState<'running' | 'finished'>('running')
  const [taskQuery, setTaskQuery] = useState('')
  const [taskStatus, setTaskStatus] = useState<'all' | TaskStatus>('all')
  const [level, setLevel] = useState<LogLevelFilter>('all')
  const [lineQuery, setLineQuery] = useState('')
  const [diagnostics, setDiagnostics] = useState<{ level: 'info' | 'warn' | 'error'; message: string; hint?: string }[] | null>(null)
  const [diagnosing, setDiagnosing] = useState(false)
  const bodyRef = useRef<HTMLDivElement | null>(null)
  const stickRef = useRef(true)

  // Attach the launch-log stream for as long as this page is mounted.
  useEffect(() => {
    const detach = attachLaunchLogStream()
    return () => detach()
  }, [])

  // Pick a session automatically when none is selected.
  useEffect(() => {
    if (activeSessionId) return
    const first = sortSessions(sessions)[0]
    if (first) setActive(first.id)
  }, [activeSessionId, sessions, setActive])

  const activeSession = useMemo(
    () => sessions.find((session) => session.id === activeSessionId),
    [sessions, activeSessionId],
  )

  // Pull the historical tail once per selected session.
  const fetchedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!activeSessionId) return
    if (fetchedRef.current === activeSessionId) return
    const hasBuffered = (logs[activeSessionId]?.length ?? 0) > 0
    if (hasBuffered) return
    fetchedRef.current = activeSessionId
    void api.launch.log(activeSessionId, 400)
      .then((payload) => setAll(activeSessionId, payload.lines))
      .catch(() => {
        // A session that never wrote a log file simply has nothing to show.
      })
  }, [activeSessionId, logs, setAll])

  const activeLines = activeSessionId ? logs[activeSessionId] ?? [] : []
  const visibleLines = useMemo(
    () => filterLines(activeLines, level, lineQuery),
    [activeLines, level, lineQuery],
  )
  const severe = useMemo(() => countSevere(activeLines), [activeLines])

  // Autoscroll unless the user scrolled away from the bottom.
  useEffect(() => {
    const node = bodyRef.current
    if (!node || paused || !stickRef.current) return
    node.scrollTop = node.scrollHeight
  }, [visibleLines.length, paused, activeSessionId])

  const onScroll = useCallback(() => {
    const node = bodyRef.current
    if (!node) return
    const stuck = shouldStickToBottom(node)
    stickRef.current = stuck
    if (!stuck && !useLaunchStore.getState().paused) setPaused(true)
  }, [setPaused])

  const jumpToBottom = useCallback(() => {
    const node = bodyRef.current
    if (!node) return
    node.scrollTop = node.scrollHeight
    stickRef.current = true
    setPaused(false)
  }, [setPaused])

  const runDiagnostics = useCallback(async () => {
    if (!activeSession) return
    setDiagnosing(true)
    try {
      const result = await api.instances.diagnostics(activeSession.instanceId)
      setDiagnostics(result)
      if (result.length === 0) toast.show({ level: 'info', message: '没有发现已知的崩溃特征' })
    } catch (cause) {
      toast.show({ level: 'error', message: '分析失败：' + message(cause) })
    } finally {
      setDiagnosing(false)
    }
  }, [activeSession])

  const kill = useCallback(async (session: LaunchSession) => {
    try {
      await api.launch.kill(session.id)
      await reload()
      toast.show({ level: 'warn', message: '已请求终止 ' + session.instanceId })
    } catch (cause) {
      toast.show({ level: 'error', message: '终止失败：' + message(cause) })
    }
  }, [reload])

  const cancelTask = useCallback(async (task: TaskSnapshot) => {
    try {
      await api.tasks.cancel(task.id)
      await reload()
    } catch (cause) {
      toast.show({ level: 'error', message: '取消失败：' + message(cause) })
    }
  }, [reload])

  const runningTasks = useMemo(
    () => sortTasks(tasks).filter((task) => task.status === 'running' || task.status === 'queued'),
    [tasks],
  )
  const finishedTasks = useMemo(
    () => sortTasks(tasks).filter((task) => task.status !== 'running' && task.status !== 'queued'),
    [tasks],
  )
  const shownTasks = useMemo(
    () => filterTasks(tab === 'running' ? runningTasks : finishedTasks, taskQuery, taskStatus === 'all' ? undefined : taskStatus),
    [tab, runningTasks, finishedTasks, taskQuery, taskStatus],
  )
  const runningSessions = useMemo(() => sessions.filter(isSessionActive), [sessions])

  return (
    <div className={page.stack}>
      <PageHead
        caption="LOGS"
        title="任务与日志"
        description="下载与安装任务的进度、启动会话，以及实时游戏日志"
        actions={
          <Button variant="ghost" onClick={() => void reload()}>刷新状态</Button>
        }
      />

      <StatStrip
        items={[
          { caption: 'ACTIVE', value: runningTasks.length, hint: '进行中的任务' },
          { caption: 'FINISHED', value: finishedTasks.length, hint: '已完成/失败' },
          { caption: 'SESSIONS', value: sessions.length, hint: '启动会话' },
          { caption: 'RUNNING', value: runningSessions.length, hint: '正在运行' },
          { caption: 'WARN/ERROR', value: severe.warn + ' / ' + severe.error, hint: '当前日志' },
        ]}
      />

      {notices.length > 0 ? (
        <Panel caption="NOTICES" title="服务端提示">
          <ul className={styles.diagnosticList}>
            {notices.slice(-5).reverse().map((notice) => (
              <li className={styles.diagnostic} key={notice.id}>
                <StatusDot tone={notice.level === 'error' ? 'danger' : notice.level === 'warn' ? 'warn' : 'accent'} />
                <span className={styles.diagnosticText}>
                  {notice.message}
                  <span className={styles.diagnosticHint}> · {formatRelativeTime(notice.time)}</span>
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <div className={page.columns}>
        <Panel
          caption="TASKS"
          title="任务"
          actions={
            <div className={styles.filters}>
              <Input
                className={styles.searchInput}
                placeholder="搜索任务"
                aria-label="搜索任务"
                leading={<SearchIcon />}
                value={taskQuery}
                onChange={(event) => setTaskQuery(event.target.value)}
              />
              <Select
                aria-label="任务状态"
                value={taskStatus}
                onChange={(event) => setTaskStatus(event.target.value as typeof taskStatus)}
              >
                <option value="all">全部状态</option>
                <option value="running">进行中</option>
                <option value="queued">排队中</option>
                <option value="succeeded">已完成</option>
                <option value="failed">失败</option>
                <option value="cancelled">已取消</option>
              </Select>
            </div>
          }
        >
          <Tabs
            ariaLabel="任务分组"
            value={tab}
            onChange={(key) => setTab(key as typeof tab)}
            items={[
              { key: 'running', label: '进行中', count: runningTasks.length },
              { key: 'finished', label: '已结束', count: finishedTasks.length },
            ]}
          />
          {shownTasks.length === 0 ? (
            <EmptyState
              title={tab === 'running' ? '没有进行中的任务' : '还没有已完成的任务'}
              description={tab === 'running' ? '安装版本、模组或 Java 时会在这里显示进度。' : '任务结束后会归档到这里。'}
              caption={tab === 'running' ? 'IDLE' : 'ARCHIVE'}
              compact
            />
          ) : (
            <div>
              {shownTasks.map((task) => (
                <TaskRow key={task.id} task={task} onCancel={() => void cancelTask(task)} />
              ))}
            </div>
          )}
        </Panel>

        <div className={page.side}>
          <Panel
            caption="SESSIONS"
            title="启动会话"
            actions={<Badge tone={runningSessions.length > 0 ? 'ok' : 'muted'}>{sessions.length}</Badge>}
          >
            {sessions.length === 0 ? (
              <Placeholder>还没有启动过游戏。</Placeholder>
            ) : (
              <div>
                {sortSessions(sessions).slice(0, 8).map((session) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    active={session.id === activeSessionId}
                    onSelect={() => {
                      setActive(session.id)
                      stickRef.current = true
                      setPaused(false)
                    }}
                    onKill={() => void kill(session)}
                  />
                ))}
              </div>
            )}
          </Panel>

          {activeSession ? (
            <Panel
              caption="DIAGNOSTICS"
              title="崩溃分析"
              actions={(
                <Button size="sm" variant="ghost" loading={diagnosing} onClick={() => void runDiagnostics()}>
                  分析
                </Button>
              )}
            >
              {diagnostics === null ? (
                <Placeholder>点击「分析」扫描该实例最近的日志。</Placeholder>
              ) : diagnostics.length === 0 ? (
                <Placeholder>没有发现已知的崩溃特征。</Placeholder>
              ) : (
                <ul className={styles.diagnosticList}>
                  {diagnostics.map((item, index) => (
                    <li className={styles.diagnostic} key={index}>
                      <StatusDot tone={item.level === 'error' ? 'danger' : item.level === 'warn' ? 'warn' : 'accent'} />
                      <span className={styles.diagnosticText}>
                        {item.message}
                        {item.hint ? <span className={styles.diagnosticHint}> — {item.hint}</span> : null}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
        </div>
      </div>

      <Panel
        caption="LIVE LOG"
        title={activeSession ? '实时日志 · ' + activeSession.instanceId : '实时日志'}
        actions={
          <div className={styles.filters}>
            <Select
              aria-label="日志级别"
              value={level}
              onChange={(event) => setLevel(event.target.value as LogLevelFilter)}
            >
              <option value="all">全部级别</option>
              <option value="info">信息以上</option>
              <option value="warn">警告以上</option>
              <option value="error">仅错误</option>
            </Select>
            <Input
              className={styles.searchInput}
              placeholder="过滤日志内容"
              aria-label="过滤日志"
              leading={<SearchIcon />}
              value={lineQuery}
              onChange={(event) => setLineQuery(event.target.value)}
            />
            <Tooltip content={paused ? '继续自动滚动' : '暂停自动滚动'}>
              <Button size="sm" variant={paused ? 'primary' : 'ghost'} onClick={jumpToBottom}>
                {paused ? '继续滚动' : '暂停滚动'}
              </Button>
            </Tooltip>
          </div>
        }
      >
        {!activeSessionId ? (
          <EmptyState
            title="选择一个启动会话"
            description="启动游戏后，这里的日志会实时滚动。"
            caption="NO SESSION"
            compact
            icon={<TerminalIcon />}
          />
        ) : (
          <div className={styles.logPanel}>
            <div className={styles.logToolbar}>
              <span className={styles.statsInline}>
                <StatusDot tone={activeSession && isSessionActive(activeSession) ? 'ok' : 'muted'} pulse={Boolean(activeSession && isSessionActive(activeSession))} />
                {activeSession ? sessionStatusLabel(activeSession.status) : '未知'}
                <span>·</span>
                <span>{activeLines.length} 行</span>
                <span>·</span>
                <span>{severe.warn} 警告 / {severe.error} 错误</span>
                {paused ? <Badge tone="warn">已暂停</Badge> : null}
              </span>
              <span className={styles.grow} />
              <Button
                size="sm"
                variant="quiet"
                onClick={() => {
                  if (activeSessionId) {
                    setAll(activeSessionId, [])
                    stickRef.current = true
                    setPaused(false)
                  }
                }}
              >
                清空显示
              </Button>
            </div>

            <div
              ref={bodyRef}
              className={clsx(styles.logBody, paused && styles.isPaused)}
              onScroll={onScroll}
              role="log"
              aria-live={paused ? 'off' : 'polite'}
            >
              {visibleLines.length === 0 ? (
                <p className={styles.logEmpty}>
                  {activeLines.length === 0 ? '暂无日志输出' : '没有符合过滤条件的日志行'}
                </p>
              ) : (
                visibleLines.map((line, index) => <LogRow key={index} line={line} />)
              )}
            </div>

            {paused ? (
              <div className={styles.jumpButton}>
                <Button size="sm" variant="ghost" onClick={jumpToBottom}>跳转到最新</Button>
              </div>
            ) : null}
          </div>
        )}
      </Panel>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* rows                                                                */
/* ------------------------------------------------------------------ */

function TaskRow({ task, onCancel }: { task: TaskSnapshot; onCancel: () => void }) {
  const active = task.status === 'running' || task.status === 'queued'
  return (
    <div className={clsx(page.row, styles.taskRow)}>
      <div className={styles.taskMain}>
        <div className={styles.taskHead}>
          <span className={styles.taskTitle}>{task.title}</span>
          <Badge tone={taskStatusTone(task.status)}>{taskStatusLabel(task.status)}</Badge>
          <span className={styles.taskMeta}>
            <span className="rh-mono">{task.kind}</span>
            <span>{formatRelativeTime(task.createdAt)}</span>
          </span>
        </div>
        {task.status === 'failed' && task.error ? (
          <span className={styles.taskError}>{task.error}</span>
        ) : active ? (
          <Progress
            value={task.progress.value}
            label={progressLabel(task.progress)}
            indeterminate={task.progress.value < 0}
            tone={task.status === 'queued' ? 'accent' : 'accent'}
          />
        ) : (
          <span className={styles.taskMeta}>{progressLabel(task.progress)}</span>
        )}
      </div>
      <div className={page.row__actions}>
        {active ? (
          <Button size="sm" variant="quiet" onClick={onCancel}>取消</Button>
        ) : task.finishedAt ? (
          <span className={styles.taskMeta}>{formatRelativeTime(task.finishedAt)}</span>
        ) : null}
      </div>
    </div>
  )
}

function SessionRow({ session, active, onSelect, onKill }: {
  session: LaunchSession
  active: boolean
  onSelect: () => void
  onKill: () => void
}) {
  const live = isSessionActive(session)
  return (
    <div
      className={clsx(page.row, styles.sessionRow, active && page['is-active'])}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <div className={styles.sessionMain}>
        <div className={styles.sessionHead}>
          <StatusDot tone={sessionStatusTone(session.status)} pulse={live} />
          <span className={styles.sessionName}>{session.instanceId}</span>
          <Badge tone={sessionStatusTone(session.status)}>{sessionStatusLabel(session.status)}</Badge>
        </div>
        <span className={styles.sessionMeta}>
          <span>{session.accountName}</span>
          <span>{formatRelativeTime(session.startedAt)}</span>
          <span>{exitSummary(session)}</span>
        </span>
      </div>
      <div className={page.row__actions} onClick={(event) => event.stopPropagation()}>
        {live ? (
          <Button size="sm" variant="danger" onClick={onKill}>终止</Button>
        ) : null}
      </div>
    </div>
  )
}

function LogRow({ line }: { line: LogLine }) {
  return (
    <div
      className={clsx(
        styles.logLine,
        line.level === 'error' && styles.isError,
        line.level === 'warn' && styles.isWarn,
      )}
    >
      <span className={styles.logTime}>{formatLogTime(line.time)}</span>
      <span className={clsx(styles.logLevel, styles['logLevel' + capitalize(line.level)])}>
        {line.level}
      </span>
      <span className={styles.logMessage}>{line.message}</span>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function capitalize(value: string): string {
  return value.slice(0, 1).toUpperCase() + value.slice(1)
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}

/**
 * Subscribe to the backend notice queue owned by the app store.
 *
 * Notices are pushed by `applyEvent` when a `notice` server event arrives; the
 * queue is module-scoped there, so this hook only mirrors it for rendering.
 */
function useServerNotices(): ServerNotice[] {
  const [items, setItems] = useState<ServerNotice[]>(() => currentNoticesSnapshot())
  useEffect(() => subscribeNotices(setItems), [])
  return items
}

function currentNoticesSnapshot(): ServerNotice[] {
  try {
    return currentNotices()
  } catch {
    return []
  }
}
