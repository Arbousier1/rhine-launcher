/**
 * Ellan Launcher 风格主页（仅复刻可见 UI）。
 * 版式取自其源码：窄图标侧栏（头像/主页/市场/实例/设置）+ 卡片仪表盘；
 * 配色与圆角取自 theme.ts 与 surfaceTokens.ts。数据全部来自本启动器真实能力。
 */
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAppStore, useModStore } from '@/stores'
import { loadLauncher, launchInstance, stopInstance } from '@/console/launcher-bridge'
import { currentAccountId as readCurrentAccountId } from '@/stores'
import '@/features/ellan/ellan-theme.css'

const ICONS: Record<string, string> = {
  home: 'M12 3 2 12h3v9h6v-6h2v6h6v-9h3z',
  store: 'M12 2 3 6v2h18V6zM5 10v10h14V10h-2v8h-3v-6H9v6H7v-8z',
  settings: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8zm9 4-2 1 1 2-2 2-2-1-1 2h-3l-1-2-2 1-2-2 1-2-2-1v-3l2-1-1-2 2-2 2 1 1-2h3l1 2 2-1 2 2-1 2 2 1z',
  user: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zm0 2c-4 0-8 2-8 5v1h16v-1c0-3-4-5-8-5z',
  play: 'M8 5v14l11-7z',
  stop: 'M6 6h12v12H6z',
}

function Icon({ name }: { name: string }) {
  return (<svg viewBox="0 0 24 24" aria-hidden="true"><path d={ICONS[name] ?? ICONS.home} /></svg>)
}

export default function EllanPage() {
  const navigate = useNavigate()
  const instances = useAppStore((s) => s.instances)
  const accounts = useAppStore((s) => s.accounts)
  const sessions = useAppStore((s) => s.sessions)
  const currentAccount = readCurrentAccountId()
  const mods = useModStore((s) => s.mods)
  const [selected, setSelected] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { void loadLauncher() }, [])
  useEffect(() => {
    if (!selected && instances[0]) setSelected(instances[0].id)
  }, [instances, selected])

  const instance = useMemo(
    () => instances.find((i) => i.id === selected) ?? instances[0],
    [instances, selected],
  )
  const account = accounts.find((a) => a.id === currentAccount) ?? accounts[0]
  const running = sessions.find(
    (s) => s.instanceId === instance?.id && (s.status === 'running' || s.status === 'starting'),
  )
  const enabledMods = mods.filter((m) => m.enabled).length
  const subtitle = instance
    ? instance.gameVersion + ' · ' + (account?.name ?? '未选择账号')
    : '前往实例列表创建第一个游戏'

  const act = async (label: string, work: () => Promise<unknown>) => {
    setBusy(label); setError(null)
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  return (
    <div className="ellan">


      <main className="ellan__main">
        {error ? <p className="ellan__alert" role="alert">{error}</p> : null}
        <div className="ellan__hero">
          <div>
            <h1>{instance?.name ?? '还没有游戏实例'}</h1>
            <p>{subtitle}</p>
          </div>
          <div className="ellan__spacer" />
          {running ? (
            <button className="ellan__btn" disabled={!!busy} onClick={() => void act('停止', () => stopInstance(running.id))}>
              <Icon name="stop" /> 停止
            </button>
          ) : (
            <button className="ellan__btn ellan__btn--primary" disabled={!instance || !!busy}
              onClick={() => instance && void act('启动', () => launchInstance(instance.id))}>
              <Icon name="play" /> {busy === '启动' ? '启动中...' : '启动'}
            </button>
          )}
        </div>

        <section className="ellan__grid">
          <article className="ellan__card">
            <h2>状态</h2>
            <strong>{running ? '运行中' : '未运行'}</strong>
            <small>{running?.pid ? '进程 ' + running.pid : '启动中...'}</small>
          </article>
          <article className="ellan__card">
            <h2>账号</h2>
            <strong>{account?.name ?? '未登录'}</strong>
            <small>{account ? (account.kind === 'offline' ? '离线账号' : '微软账号') : '在账号页添加'}</small>
          </article>
          <article className="ellan__card">
            <h2>模组</h2>
            <strong>{mods.length}</strong>
            <small>{enabledMods} 个已启用</small>
          </article>
          <article className="ellan__card ellan__card--wide">
            <h2>实例列表</h2>
            {instances.length ? (
              <ul className="ellan__list">
                {instances.slice(0, 5).map((item) => (
                  <li key={item.id} className="ellan__row">
                    <span>{item.name}</span>
                    <span className="ellan__pill">{item.gameVersion}</span>
                  </li>
                ))}
              </ul>
            ) : <p className="ellan__empty">还没有实例</p>}
          </article>
          <article className="ellan__card ellan__card--wide">
            <h2>快捷操作</h2>
            <div className="ellan__row" style={{ flexWrap: 'wrap', gap: 10 }}>
              <button className="ellan__btn" onClick={() => navigate('/archive')}>实例列表</button>
              <button className="ellan__btn" onClick={() => navigate('/versions')}>下载</button>
              <button className="ellan__btn" onClick={() => navigate('/mods')}>Mod</button>
              <button className="ellan__btn" onClick={() => navigate('/logs')}>日志与崩溃</button>
            </div>
          </article>
        </section>
      </main>
    </div>
  )
}
