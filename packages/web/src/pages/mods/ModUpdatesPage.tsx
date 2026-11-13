import { apiUrl } from '@/api/client'
/**
 * view.mod-updates — 模组批量更新检查（对应 XMCL 的 Mod 更新能力）。
 *
 * 真实接口：GET /api/instances/:id/mods/updates?source=、POST .../mods/updates/apply。
 */
import { useCallback, useEffect, useState } from 'react'
import { useCurrentInstance } from '@/features/common/useCurrentInstance'
import { PageHead } from '@/features/common/PageHead'
import '@/features/ellan/ellan-theme.css'

interface ModUpdate { diskName: string; name?: string; currentVersion?: string; latestVersion?: string }

export default function ModUpdatesPage() {
  const { instance, instanceId } = useCurrentInstance()
  const [source, setSource] = useState<'modrinth' | 'curseforge'>('modrinth')
  const [updates, setUpdates] = useState<ModUpdate[]>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const check = useCallback(async () => {
    if (!instanceId) return
    setLoading(true); setError(null); setMessage(null)
    try {
      const response = await fetch(apiUrl('/api/instances/') + encodeURIComponent(instanceId) + '/mods/updates?source=' + source)
      if (!response.ok) throw new Error('检查失败：HTTP ' + response.status)
      setUpdates(await response.json() as ModUpdate[])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [instanceId, source])

  useEffect(() => { void check() }, [check])

  const apply = async () => {
    if (!instanceId || !updates.length) return
    setBusy(true); setError(null); setMessage(null)
    try {
      const response = await fetch(apiUrl('/api/instances/') + encodeURIComponent(instanceId) + '/mods/updates/apply', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ source, updates: updates.map((u) => ({ diskName: u.diskName, version: u.latestVersion })) }),
      })
      if (!response.ok) throw new Error('更新失败：HTTP ' + response.status)
      setMessage('已提交更新任务')
      await check()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(false) }
  }

  return (
    <div className="ellan" style={{ gridTemplateColumns: '1fr' }}>
      <main className="ellan__main">
        <PageHead caption="MOD UPDATES" title="模组更新" description="检查实例内模组是否有可用的新版本。" />
        <div className="ellan__hero">
          <div>
            <h1>{instance?.name ?? '未选择实例'}</h1>
            <p>{loading ? '检查中…' : updates.length ? updates.length + ' 个模组可更新' : '全部为最新版本'}</p>
          </div>
          <div className="ellan__spacer" />
          <button className={source === 'modrinth' ? 'ellan__btn ellan__btn--primary' : 'ellan__btn'} onClick={() => setSource('modrinth')}>Modrinth</button>
          <button className={source === 'curseforge' ? 'ellan__btn ellan__btn--primary' : 'ellan__btn'} onClick={() => setSource('curseforge')}>CurseForge</button>
          <button className="ellan__btn" disabled={loading || !instanceId} onClick={() => void check()}>重新检查</button>
          <button className="ellan__btn ellan__btn--primary" disabled={!updates.length || busy} onClick={() => void apply()}>
            {busy ? '更新中…' : '全部更新'}
          </button>
        </div>
        {error ? <p className="ellan__alert" role="alert">{error}</p> : null}
        {message ? <p className="ellan__pill ellan__pill--ok" role="status">{message}</p> : null}
        <section className="ellan__grid">
          {updates.length === 0 && !loading ? (
            <article className="ellan__card ellan__card--wide">
              <h2>结果</h2>
              <p style={{ margin: 0 }}>没有可更新的模组</p>
              <small>切换来源或稍后重试；未安装模组的实例也会得到空结果。</small>
            </article>
          ) : updates.map((update) => (
            <article className="ellan__card" key={update.diskName}>
              <h2>{update.name ?? update.diskName}</h2>
              <p style={{ margin: 0 }}>{update.currentVersion ?? '未知'} → {update.latestVersion ?? '最新'}</p>
              <small className="rh-mono">{update.diskName}</small>
            </article>
          ))}
        </section>
      </main>
    </div>
  )
}
