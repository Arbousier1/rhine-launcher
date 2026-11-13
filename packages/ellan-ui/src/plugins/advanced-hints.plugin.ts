import { defineFeature } from '@rhine/plugin-api'
import css from '../styles/advanced-hints.css?inline'

export interface BootstrapInfo {
  instances: { name: string; path: string; gameVersion: string; memory: { minMb: number; maxMb: number }; javaPath?: string; loaders: { kind: string; version: string }[] }[]
  javaRuntimes: { majorVersion: number; version: string; path: string }[]
  accounts: { kind: string; name: string }[]
  tasks: { status: string }[]
}

/** Presentation of actual configuration only; never an invented ready status. */
export function environmentSummary(data: BootstrapInfo, selected?: string | null) {
  const instance = data.instances.find(i => i.path === selected) ?? data.instances[0]
  const java = instance?.javaPath ? data.javaRuntimes.find(j => j.path === instance.javaPath) : undefined
  const javaValue = instance?.javaPath
    ? java ? 'Java ' + java.majorVersion + ' · ' + java.version : '指定路径 · 尚未验证'
    : '自动选择 · 已发现 ' + data.javaRuntimes.length + ' 个'
  return {
    title: instance?.name ?? '运行环境',
    rows: [
      { label: '游戏版本', value: instance?.gameVersion ?? '未选择' },
      { label: '加载器', value: instance ? instance.loaders.map(l => l.kind + ' ' + l.version).join(' / ') || '原版' : '未选择' },
      { label: 'Java 运行时', value: javaValue },
      { label: '分配内存', value: instance ? instance.memory.minMb + '–' + instance.memory.maxMb + ' MB' : '未配置' },
      { label: '已添加账号', value: data.accounts.map(a => a.name + ' · ' + (a.kind === 'offline' ? '离线' : a.kind)).join(' / ') || '未登录' },
      { label: '后台任务', value: data.tasks.filter(t => t.status === 'queued' || t.status === 'running').length + ' 项进行中' },
      { label: '实例目录', value: instance?.path ?? '未选择', path: true },
    ],
  }
}

export default defineFeature({
  id: 'ui.hints.advanced', capability: 'ui.hints.advanced', title: '环境信息提示',
  execute: () => ({ available: true }),
  async setup(env) {
    if (!document.body) await new Promise<void>((resolve, reject) => {
      const ready = () => { env.signal.removeEventListener('abort', abort); resolve() }
      const abort = () => { document.removeEventListener('DOMContentLoaded', ready); reject(env.signal.reason) }
      document.addEventListener('DOMContentLoaded', ready, { once: true })
      env.signal.addEventListener('abort', abort, { once: true })
    })
    env.signal.throwIfAborted()
    const doc = document
    function element<K extends keyof HTMLElementTagNameMap>(tag: K, className: string, text?: string) {
      const node = doc.createElement(tag)
      node.className = className
      if (text !== undefined) node.textContent = text
      return node
    }
    const button = element('button', 'rh-advanced-trigger', '环境信息')
    button.type = 'button'
    button.setAttribute('aria-expanded', 'false')
    button.setAttribute('aria-haspopup', 'dialog')
    button.setAttribute('aria-controls', 'rh-advanced-environment')
    const panel = element('section', 'rh-advanced-panel')
    panel.id = 'rh-advanced-environment'
    panel.hidden = true
    panel.tabIndex = -1
    panel.setAttribute('role', 'dialog')
    panel.setAttribute('aria-label', '环境信息')
    const style = doc.createElement('style')
    style.dataset.rhinePlugin = 'ui.hints.advanced'
    style.textContent = css
    doc.head.append(style)
    doc.body.append(button, panel)
    let open = false, sequence = 0, request: AbortController | undefined

    const hide = (restoreFocus = false) => {
      open = false; sequence++
      request?.abort(); request = undefined
      panel.hidden = true
      button.setAttribute('aria-expanded', 'false')
      if (restoreFocus) button.focus()
    }
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape' && open) { event.preventDefault(); hide(true) } }
    const onOutside = (event: Event) => {
      if (open && !panel.contains(event.target as Node) && !button.contains(event.target as Node)) hide()
    }
    const onClick = async () => {
      if (open) { hide(); return }
      open = true
      const current = ++sequence
      request = new AbortController()
      const signal = AbortSignal.any([env.signal, request.signal])
      panel.hidden = false
      button.setAttribute('aria-expanded', 'true')
      const heading = element('div', 'rh-advanced-header')
      const titleGroup = element('div', 'rh-advanced-title')
      const eyebrow = element('span', 'rh-advanced-eyebrow', 'ENVIRONMENT')
      const title = element('h3', '', '运行环境')
      titleGroup.append(eyebrow, title)
      const close = element('button', 'rh-advanced-close', '×')
      close.type = 'button'
      close.setAttribute('aria-label', '关闭环境信息')
      close.addEventListener('click', () => hide(true), { once: true })
      heading.append(titleGroup, close)
      const status = element('p', 'rh-advanced-status', '正在读取当前配置…')
      status.setAttribute('role', 'status')
      const content = element('div', 'rh-advanced-content')
      content.append(status)
      panel.replaceChildren(heading, content)
      close.focus()
      try {
        const response = await fetch('/api/bootstrap', { signal })
        if (!response.ok) throw new Error('暂时无法读取运行环境，请关闭后重试。')
        const data: BootstrapInfo = await response.json()
        if (signal.aborted || !open || current !== sequence) return
        let selected = localStorage.getItem('selectedInstancePath')
        try { const parsed: unknown = JSON.parse(selected ?? 'null'); if (typeof parsed === 'string') selected = parsed } catch { /* Original raw path preference. */ }
        const summary = environmentSummary(data, selected)
        title.textContent = summary.title
        const list = doc.createElement('dl')
        for (const row of summary.rows) {
          const item = element('div', 'rh-advanced-stat' + (row.path ? ' rh-advanced-stat--wide rh-advanced-stat--path' : ''))
          item.append(element('dt', '', row.label), element('dd', '', row.value))
          list.append(item)
        }
        const note = element('p', 'rh-advanced-note', '以上为当前配置与已发现的环境。启动前仍会进行版本、文件、账号和 Java 预检。')
        content.replaceChildren(list, note)
      } catch (error) {
        if (!signal.aborted && open && current === sequence) status.textContent = error instanceof Error ? error.message : String(error)
      }
    }
    button.addEventListener('click', onClick)
    doc.addEventListener('keydown', onKey)
    doc.addEventListener('pointerdown', onOutside)
    env.onDispose(() => {
      const restoreFocus = panel.contains(doc.activeElement)
      hide(restoreFocus)
      button.removeEventListener('click', onClick)
      doc.removeEventListener('keydown', onKey)
      doc.removeEventListener('pointerdown', onOutside)
      button.remove(); panel.remove(); style.remove()
    })
  },
})
