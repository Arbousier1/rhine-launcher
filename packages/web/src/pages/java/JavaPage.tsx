/**
 * Java runtime page.
 *
 * Lists every detected runtime (managed ones first), shows which one the
 * selected instance would pick, and downloads Mojang JREs on demand while the
 * task progress streams in over WebSocket.
 */
import { useCallback, useEffect, useMemo } from 'react'
import clsx from 'clsx'
import type { JavaRuntime } from '@rhine/core'
import { api } from '@/api/client'
import {
  Badge, Button, EmptyState, IconButton, Panel, Progress, Spinner, Tooltip, toast,
} from '@/ui'
import { CoffeeIcon, FolderIcon, RefreshIcon } from '@/ui/icons'
import { PageHead } from '@/features/common/PageHead'
import { Notice, Placeholder, StatStrip } from '@/features/common/toolbar'
import { useCurrentInstance } from '@/features/common/useCurrentInstance'
import {
  JAVA_COMPONENTS, archLabel, bestRuntime, groupByMajor, requiredJavaMajor,
  supportedGameVersions, summarizeRuntimes, vendorLabel,
} from '@/features/java/java.ts'
import { progressLabel } from '@/features/logs/logs.ts'
import { useAppStore, useJavaStore } from '@/stores'
import page from '@/features/common/page.module.css'
import styles from './java.module.css'

export default function JavaPage() {
  const runtimesFromBootstrap = useAppStore((state) => state.javaRuntimes)
  const paths = useAppStore((state) => state.paths)
  const tasks = useAppStore((state) => state.tasks)
  const { instance } = useCurrentInstance()

  const runtimes = useJavaStore((state) => state.runtimes)
  const scanning = useJavaStore((state) => state.scanning)
  const error = useJavaStore((state) => state.error)
  const downloads = useJavaStore((state) => state.downloads)
  const taskIds = useJavaStore((state) => state.taskIds)
  const seed = useJavaStore((state) => state.seed)
  const scan = useJavaStore((state) => state.scan)
  const download = useJavaStore((state) => state.download)

  useEffect(() => {
    seed(runtimesFromBootstrap)
  }, [runtimesFromBootstrap, seed])

  const list = runtimes.length > 0 ? runtimes : runtimesFromBootstrap
  const groups = useMemo(() => groupByMajor(list), [list])
  const stats = useMemo(() => summarizeRuntimes(list), [list])

  const requiredMajor = instance ? requiredJavaMajor(instance.gameVersion) : 21
  const recommended = useMemo(
    () => bestRuntime(list, requiredMajor, instance?.javaPath),
    [list, requiredMajor, instance?.javaPath],
  )

  const onScan = useCallback(async () => {
    try {
      const found = await scan()
      toast.show({ level: 'ok', message: '扫描完成，找到 ' + found.length + ' 个 Java 运行时' })
    } catch (cause) {
      toast.show({ level: 'error', message: '扫描失败：' + message(cause) })
    }
  }, [scan])

  const onDownload = useCallback(
    async (component: string) => {
      try {
        const taskId = await download(component)
        toast.show({ level: 'ok', message: '已开始下载 ' + component + '（任务 ' + taskId.slice(0, 6) + '）' })
      } catch (cause) {
        toast.show({ level: 'error', message: '下载失败：' + message(cause) })
      }
    },
    [download],
  )

  const openJavaDir = useCallback(async () => {
    if (!paths?.java) return
    try {
      await api.system.reveal(paths.java)
    } catch (cause) {
      toast.show({ level: 'error', message: '无法打开目录：' + message(cause) })
    }
  }, [paths])

  return (
    <div className={page.stack}>
      <PageHead
        caption="RUNTIME"
        title="Java 运行时"
        description="扫描本机 Java，或下载 Mojang 提供的托管运行时"
        actions={
          <>
            <Tooltip content="打开托管目录">
              <IconButton label="打开 Java 目录" onClick={() => void openJavaDir()}>
                <FolderIcon />
              </IconButton>
            </Tooltip>
            <IconButton label="重新扫描" onClick={() => void onScan()} disabled={scanning}>
              <RefreshIcon />
            </IconButton>
            <Button variant="primary" loading={scanning} onClick={() => void onScan()}>
              扫描 Java
            </Button>
          </>
        }
      />

      <StatStrip
        items={[
          { caption: 'FOUND', value: stats.total, hint: '检测到的运行时' },
          { caption: 'MANAGED', value: stats.managed, hint: '启动器托管' },
          { caption: 'MAJORS', value: stats.majors.join(' / ') || '—', hint: '可用主版本' },
          { caption: 'NEEDED', value: 'Java ' + requiredMajor, hint: instance ? instance.gameVersion : '默认' },
        ]}
      />

      {error ? <Notice level="danger" title="扫描失败">{error}</Notice> : null}

      {instance && !recommended ? (
        <Notice level="warn" title="缺少合适的 Java">
          {instance.name}（{instance.gameVersion}）需要 Java {requiredMajor} 或更高版本，扫描结果里没有匹配项。
          可以从下方下载官方运行时，或在档案设置里手动指定 java 路径。
        </Notice>
      ) : null}

      <div className={page.columns}>
        <Panel
          caption="RUNTIMES"
          title="已安装的运行时"
          actions={scanning ? <Spinner size="sm" label="扫描中" /> : null}
        >
          {list.length === 0 ? (
            <EmptyState
              title="没有检测到 Java"
              description="点击「扫描 Java」重新检测，或从右侧下载一个托管运行时。"
              caption="NO RUNTIME"
              compact
              action={<Button variant="primary" onClick={() => void onScan()}>立即扫描</Button>}
            />
          ) : (
            groups.map((group) => (
              <div key={group.major}>
                <div className={styles.groupLabel}>
                  <span className={styles.groupMajor}>Java {group.major}</span>
                  <span className={styles.groupHint}>
                    {group.items.length} 个 · {supportedGameVersions(group.major)}
                  </span>
                </div>
                {group.items.map((runtime) => (
                  <RuntimeRow
                    key={runtime.path}
                    runtime={runtime}
                    recommended={recommended?.path === runtime.path}
                  />
                ))}
              </div>
            ))
          )}
        </Panel>

        <div className={page.side}>
          <Panel caption="MANAGED" title="下载托管运行时">
            <p className={clsx(page.dim, page.tiny)}>
              下载到 <span className="rh-mono">{paths?.java ?? '&lt;root&gt;/java'}</span>，不会影响系统安装的 Java。
            </p>
            <div className={styles.downloadList}>
              {JAVA_COMPONENTS.map((component) => {
                const phase = downloads[component.component]
                const taskId = taskIds[component.component]
                const task = taskId ? tasks.find((item) => item.id === taskId) : undefined
                const present = list.some((runtime) => runtime.majorVersion === component.major && runtime.managed)
                return (
                  <div className={styles.downloadRow} key={component.component}>
                    <div className={styles.downloadHead}>
                      <div className={styles.downloadName}>
                        <span className={styles.downloadTitle}>{component.label}</span>
                      </div>
                      {present ? (
                        <Badge tone="ok">已安装</Badge>
                      ) : (
                        <Button
                          size="sm"
                          variant={phase === 'downloading' ? 'quiet' : 'ghost'}
                          loading={phase === 'downloading'}
                          onClick={() => void onDownload(component.component)}
                        >
                          下载
                        </Button>
                      )}
                    </div>
                    <span className={styles.downloadMeta}>{component.component}</span>
                    {task && task.status === 'running' ? (
                      <div>
                        <Progress
                          value={task.progress.value}
                          label={progressLabel(task.progress)}
                          indeterminate={task.progress.value < 0}
                        />
                      </div>
                    ) : task && task.status === 'failed' ? (
                      <span className={page.dangerText}>{task.error ?? '下载失败'}</span>
                    ) : null}
                  </div>
                )
              })}
            </div>
          </Panel>

          <Panel caption="RECOMMEND" title="推荐选择">
            {instance ? (
              <div className={styles.recommend}>
                <p className={clsx(page.dim, page.tiny)}>
                  {instance.name}（{instance.gameVersion}）推荐 Java {requiredMajor}。
                </p>
                {recommended ? (
                  <div className={styles.recommendRow}>
                    <span className="rh-mono">{recommended.version}</span>
                    <Badge tone={recommended.managed ? 'accent' : 'muted'}>
                      {recommended.managed ? '托管' : '系统'}
                    </Badge>
                  </div>
                ) : (
                  <Placeholder>没有可用的运行时。</Placeholder>
                )}
              </div>
            ) : (
              <Placeholder>选择一个实例后显示推荐版本。</Placeholder>
            )}
          </Panel>
        </div>
      </div>
    </div>
  )
}

function RuntimeRow({ runtime, recommended }: { runtime: JavaRuntime; recommended: boolean }) {
  return (
    <div className={clsx(page.row, styles.row, recommended && page['is-active'])}>
      <span className={clsx(styles.majorBadge, runtime.managed && styles.managedMark)}>{runtime.majorVersion}</span>
      <div className={page.row__main}>
        <span className={page.row__title}>
          {runtime.version}
          {recommended ? <Badge tone="accent"> 推荐 </Badge> : null}
        </span>
        <span className={styles.path} title={runtime.path}>{runtime.path}</span>
        <span className={page.row__meta}>
          <Badge tone={runtime.managed ? 'accent' : 'muted'}>{runtime.managed ? '托管' : '系统'}</Badge>
          <span>{vendorLabel(runtime.vendor)}</span>
          <span>{archLabel(runtime.arch)}</span>
        </span>
      </div>
      <div className={page.row__actions}>
        {runtime.managed ? <CoffeeIcon /> : null}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}