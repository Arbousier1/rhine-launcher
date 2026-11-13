/**
 * view.eu — 整合包与实例迁移中心（对应 XMCL 独有的整合包/迁移向导）。
 *
 * 真实能力：POST /api/modpacks/identify、/api/modpacks/{modrinth,curseforge}/import、
 * /api/instances/import-modpack、/api/instances/:id/duplicate。
 */
import { useState } from 'react'
import { useCurrentInstance } from '@/features/common/useCurrentInstance'
import { PageHead } from '@/features/common/PageHead'
import '@/features/ellan/ellan-theme.css'

type Tab = 'import' | 'duplicate'

export default function ModpackPage() {
  const { instance, instanceId, instances } = useCurrentInstance()
  const [tab, setTab] = useState<Tab>('import')
  const [source, setSource] = useState<'modrinth' | 'curseforge'>('modrinth')
  const [projectId, setProjectId] = useState('')
  const [copyName, setCopyName] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const post = async (url: string, body: unknown) => {
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!response.ok) throw new Error((await response.text()) || 'HTTP ' + response.status)
    return response.json()
  }

  const act = async (label: string, work: () => Promise<void>) => {
    setBusy(label); setError(null); setMessage(null)
    try { await work() } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setBusy(null) }
  }

  const importPack = () => act('导入', async () => {
    if (!projectId.trim()) throw new Error('请填写项目 ID 或整合包标识')
    const result = await post('/api/modpacks/' + source + '/import', { projectId: projectId.trim() })
    setMessage('已提交导入任务：' + (result?.id ?? projectId.trim()))
    setProjectId('')
  })

  const duplicate = () => act('复制', async () => {
    if (!instanceId) throw new Error('请先选择一个实例')
    const name = copyName.trim() || (instance?.name ?? 'instance') + ' - 副本'
    const created = await post('/api/instances/' + encodeURIComponent(instanceId) + '/duplicate', { name })
    setMessage('已复制为：' + (created?.id ?? name))
    setCopyName('')
  })

  return (
    <div className="ellan" style={{ gridTemplateColumns: '1fr' }}>
      <main className="ellan__main">
        <PageHead caption="MIGRATE" title="整合包与迁移" description="导入整合包，或复制现有实例作为新档案。" />
        {error ? <p className="ellan__alert" role="alert">{error}</p> : null}
        {message ? <p className="ellan__pill ellan__pill--ok" role="status">{message}</p> : null}
        <div className="ellan__hero" style={{ gap: 10 }}>
          <button className={tab === 'import' ? 'ellan__btn ellan__btn--primary' : 'ellan__btn'} onClick={() => setTab('import')}>导入整合包</button>
          <button className={tab === 'duplicate' ? 'ellan__btn ellan__btn--primary' : 'ellan__btn'} onClick={() => setTab('duplicate')}>复制实例</button>
        </div>
        {tab === 'import' ? (
          <section className="ellan__grid">
            <article className="ellan__card ellan__card--wide">
              <h2>来源</h2>
              <div className="ellan__row" style={{ gap: 10 }}>
                <button className={source === 'modrinth' ? 'ellan__btn ellan__btn--primary' : 'ellan__btn'} onClick={() => setSource('modrinth')}>Modrinth</button>
                <button className={source === 'curseforge' ? 'ellan__btn ellan__btn--primary' : 'ellan__btn'} onClick={() => setSource('curseforge')}>CurseForge</button>
              </div>
              <small>CurseForge 需要有效的 API Key，在设置中配置。</small>
            </article>
            <article className="ellan__card ellan__card--wide">
              <h2>项目标识</h2>
              <input className="ellan__input" value={projectId} placeholder={source === 'modrinth' ? '例如 fabulously-optimized' : '例如 123456'}
                onChange={(event) => setProjectId(event.target.value)} />
              <button className="ellan__btn ellan__btn--primary" disabled={busy !== null} onClick={() => void importPack()}>
                {busy === '导入' ? '正在提交…' : '开始导入'}
              </button>
            </article>
          </section>
        ) : (
          <section className="ellan__grid">
            <article className="ellan__card ellan__card--wide">
              <h2>源实例</h2>
              <p style={{ margin: 0 }}>{instance?.name ?? '未选择实例'}</p>
              <small>共 {instances.length} 个实例；复制会连同 mods 与配置一并克隆。</small>
            </article>
            <article className="ellan__card ellan__card--wide">
              <h2>新实例名称</h2>
              <input className="ellan__input" value={copyName} placeholder={(instance?.name ?? 'instance') + ' - 副本'}
                onChange={(event) => setCopyName(event.target.value)} />
              <button className="ellan__btn ellan__btn--primary" disabled={busy !== null} onClick={() => void duplicate()}>
                {busy === '复制' ? '正在复制…' : '复制实例'}
              </button>
            </article>
          </section>
        )}
      </main>
    </div>
  )
}
