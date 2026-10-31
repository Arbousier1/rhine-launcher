/**
 * The pulled-out archive card.
 *
 * Rendered inside the rack stage so it reads as the slab that was extracted:
 * the version is the headline, the overview answers "what will start if I press
 * this", and the launch button lives here — no separate launcher page.
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { Instance } from '@rhine/core'
import { api } from '@/api/client'
import { Badge, Button, Spinner, StatusDot, toast } from '@/ui'
import { CloseIcon, FolderIcon, PlayIcon, RefreshIcon } from '@/ui/icons'
import { formatDateTime } from '@/app/theme.ts'
import { formatPlayTime, relativeTime } from '@/ui/grid-nav.ts'
import { useAppStore } from '@/app/data.ts'
import { useLaunchStore } from '@/stores/launch.ts'
import { loaderLabel, memoryLabel } from './archive-logic.ts'

const EMPTY_LINES: never[] = []

export interface InstanceDossierProps {
  instance: Instance
  number: string
  onClose: () => void
  /** Called after a launch was accepted, so the page can keep the card open. */
  onLaunched?: (sessionId: string) => void
}

export function InstanceDossier({ instance, number, onClose, onLaunched }: InstanceDossierProps) {
  const navigate = useNavigate()
  const accounts = useAppStore((state) => state.accounts)
  const sessions = useAppStore((state) => state.sessions)
  const javaRuntimes = useAppStore((state) => state.javaRuntimes)
  const [mods, setMods] = useState<number | null>(null)
  const [modsError, setModsError] = useState(false)
  const [launching, setLaunching] = useState(false)
  const [stopping, setStopping] = useState(false)

  const session = useMemo(
    () =>
      sessions.find(
        (item) => item.instanceId === instance.id && (item.status === 'running' || item.status === 'starting'),
      ),
    [sessions, instance.id],
  )
  // Select the stable map, then derive: returning a fresh [] from the selector
  // would make useSyncExternalStore re-render forever.
  const logMap = useLaunchStore((state) => state.logs)
  const lines = session ? (logMap[session.id] ?? EMPTY_LINES) : EMPTY_LINES

  useEffect(() => {
    let cancelled = false
    setMods(null)
    setModsError(false)
    api.instances
      .mods(instance.id)
      .then((list) => {
        if (!cancelled) setMods(list.length)
      })
      .catch(() => {
        if (!cancelled) setModsError(true)
      })
    return () => {
      cancelled = true
    }
  }, [instance.id])

  const java = instance.javaPath || javaRuntimes[0]?.path || '自动选择'

  const launch = async () => {
    const account = accounts[0]
    if (!account) {
      toast.show({ level: 'warn', message: '还没有账号，先添加一个离线或微软账号' })
      navigate('/accounts')
      return
    }
    setLaunching(true)
    try {
      const created = await api.launch.start({
        instanceId: instance.id,
        accountId: account.id,
        detach: true,
        memoryMb: instance.memory?.maxMb,
      })
      toast.show({ level: 'ok', message: '已启动 ' + instance.name + (created.pid ? '（pid ' + created.pid + '）' : '') })
      onLaunched?.(created.id)
    } catch (error) {
      toast.show({ level: 'error', message: '启动失败：' + (error instanceof Error ? error.message : String(error)) })
    } finally {
      setLaunching(false)
    }
  }

  const stop = async () => {
    if (!session) return
    setStopping(true)
    try {
      await api.launch.kill(session.id)
      toast.show({ level: 'info', message: '已请求结束游戏进程' })
    } catch (error) {
      toast.show({ level: 'error', message: '停止失败：' + (error instanceof Error ? error.message : String(error)) })
    } finally {
      setStopping(false)
    }
  }

  const reveal = async () => {
    try {
      await api.system.reveal(instance.path)
    } catch (error) {
      toast.show({ level: 'error', message: '无法打开目录：' + (error instanceof Error ? error.message : String(error)) })
    }
  }

  return (
    <article className="rh-dossier" role="dialog" aria-label={'档案 ' + instance.name} aria-modal="false">
      <header className="rh-dossier__head">
        <span className="rh-dossier__number">{number}</span>
        <span className="rh-dossier__state">
          {session ? (
            <>
              <StatusDot tone="accent" pulse />
              {session.status === 'starting' ? '正在启动' : '运行中'}
            </>
          ) : (
            <>
              <StatusDot tone="muted" />
              {instance.lastLaunchedAt ? '空闲' : '新档案'}
            </>
          )}
        </span>
        <button type="button" className="rh-dossier__close" onClick={onClose} aria-label="收回卡片">
          <CloseIcon />
        </button>
      </header>

      <div className="rh-dossier__title">
        <span className="rh-dossier__version">{instance.gameVersion || '未安装'}</span>
        <h2 className="rh-dossier__name">{instance.name}</h2>
        <div className="rh-dossier__badges">
          <Badge tone={instance.loaders?.some((loader) => loader.kind !== 'vanilla') ? 'accent' : 'muted'} mono>
            {loaderLabel(instance.loaders)}
          </Badge>
          <Badge tone="muted" mono>
            {memoryLabel(instance.memory?.minMb, instance.memory?.maxMb)}
          </Badge>
        </div>
      </div>

      <dl className="rh-dossier__grid">
        <div>
          <dt>游戏版本</dt>
          <dd>{instance.gameVersion || '未安装'}</dd>
        </div>
        <div>
          <dt>加载器</dt>
          <dd>{loaderLabel(instance.loaders)}</dd>
        </div>
        <div>
          <dt>内存</dt>
          <dd>{memoryLabel(instance.memory?.minMb, instance.memory?.maxMb)}</dd>
        </div>
        <div>
          <dt>模组</dt>
          <dd>{mods === null ? (modsError ? '读取失败' : '…') : mods + ' 个'}</dd>
        </div>
        <div>
          <dt>最近启动</dt>
          <dd>{relativeTime(instance.lastLaunchedAt)}</dd>
        </div>
        <div>
          <dt>游玩时长</dt>
          <dd>{formatPlayTime(instance.playTimeMs)}</dd>
        </div>
        <div className="rh-dossier__wide">
          <dt>Java</dt>
          <dd title={java}>{java.length > 52 ? '…' + java.slice(-50) : java}</dd>
        </div>
        <div className="rh-dossier__wide">
          <dt>路径</dt>
          <dd title={instance.path}>{instance.path.length > 52 ? '…' + instance.path.slice(-50) : instance.path}</dd>
        </div>
        <div className="rh-dossier__wide">
          <dt>创建时间</dt>
          <dd>{formatDateTime(instance.createdAt)}</dd>
        </div>
      </dl>

      {session ? (
        <div className="rh-dossier__log" aria-label="运行日志">
          {lines.length === 0 ? (
            <span className="rh-dossier__logline is-dim">等待游戏输出…</span>
          ) : (
            lines.slice(-6).map((line, index) => (
              <span key={index} className={'rh-dossier__logline is-' + line.level}>
                {line.message}
              </span>
            ))
          )}
        </div>
      ) : null}

      <footer className="rh-dossier__actions">
        {session ? (
          <Button variant="danger" leading={<CloseIcon />} loading={stopping} onClick={() => void stop()}>
            结束游戏
          </Button>
        ) : (
          <Button variant="primary" leading={<PlayIcon />} loading={launching} onClick={() => void launch()}>
            启动游戏
          </Button>
        )}
        <Button
          variant="ghost"
          leading={<FolderIcon />}
          onClick={() => navigate('/instances/' + encodeURIComponent(instance.id))}
        >
          完整档案
        </Button>
        <Button variant="quiet" leading={<FolderIcon />} onClick={() => void reveal()}>
          打开目录
        </Button>
        <span className="rh-dossier__hint">ESC 收回</span>
      </footer>
    </article>
  )
}
