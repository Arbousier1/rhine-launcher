import { apiUrl } from '@/api/client'
/**
 * view.diagnostics — 实例体检（XMCL 没有的能力，我们后端已具备）。
 *
 * 一个页面、一条路由、一个插件；数据来自 GET /api/instances/:id/diagnostics。
 */
import { useCallback, useEffect, useState } from 'react'
import { useCurrentInstance } from '@/features/common/useCurrentInstance'
import { PageHead } from '@/features/common/PageHead'
import '@/features/ellan/ellan-theme.css'

interface Finding { level: 'info' | 'warn' | 'error'; message: string; hint?: string }

const LEVEL_LABEL: Record<string, string> = { info: '正常', warn: '注意', error: '问题' }
const LEVEL_PILL: Record<string, string> = { info: 'ellan__pill--ok', warn: 'ellan__pill--warn', error: 'ellan__alert' }

export default function DiagnosticsPage() {
  const { instance, instanceId } = useCurrentInstance()
  const [findings, setFindings] = useState<Finding[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = useCallback(async () => {
    if (!instanceId) return
    setLoading(true); setError(null)
    try {
      const response = await fetch(apiUrl('/api/instances/') + encodeURIComponent(instanceId) + '/diagnostics')
      if (!response.ok) throw new Error('体检失败：HTTP ' + response.status)
      setFindings(await response.json() as Finding[])
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
    finally { setLoading(false) }
  }, [instanceId])

  useEffect(() => { void run() }, [run])

  const errors = findings.filter((f) => f.level === 'error').length
  const warns = findings.filter((f) => f.level === 'warn').length

  return (
    <div className="ellan" style={{ gridTemplateColumns: '1fr' }}>
      <main className="ellan__main">
        <PageHead caption="DIAGNOSTICS" title="实例体检" description="检查启动日志与运行环境，给出可执行的建议。" />
        <div className="ellan__hero">
          <div>
            <h1>{instance?.name ?? '未选择实例'}</h1>
            <p>{errors ? errors + ' 个问题，' + warns + ' 项注意' : warns ? warns + ' 项注意' : '未发现问题'}</p>
          </div>
          <div className="ellan__spacer" />
          <button className="ellan__btn ellan__btn--primary" disabled={!instanceId || loading} onClick={() => void run()}>
            {loading ? '检查中…' : '重新检查'}
          </button>
        </div>
        {error ? <p className="ellan__alert" role="alert">{error}</p> : null}
        <section className="ellan__grid">
          {findings.length === 0 && !loading
            ? <p className="ellan__empty">暂无检查结果</p>
            : findings.map((finding, index) => (
              <article className="ellan__card" key={index}>
                <h2>{LEVEL_LABEL[finding.level] ?? finding.level}</h2>
                <p style={{ margin: 0 }}>{finding.message}</p>
                {finding.hint ? <small>{finding.hint}</small> : null}
              </article>
            ))}
        </section>
      </main>
    </div>
  )
}
