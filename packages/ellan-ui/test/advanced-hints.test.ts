import { afterEach, describe, expect, it, vi } from 'vitest'
import { FeatureRuntime } from '@rhine/plugin-api'
import plugin, { environmentSummary, type BootstrapInfo } from '../src/plugins/advanced-hints.plugin.ts'

const data: BootstrapInfo = {
  instances: [{ name: 'Actual instance', path: '/actual', gameVersion: '1.20.1', memory: { minMb: 1024, maxMb: 2048 }, loaders: [{ kind: 'fabric', version: '0.20.1' }] }],
  javaRuntimes: [{ path: '/java17', majorVersion: 17, version: '17.0.1' }],
  accounts: [{ name: 'Steve', kind: 'offline' }],
  tasks: [{ status: 'running' }, { status: 'queued' }, { status: 'completed' }],
}

/** Small DOM contract fixture; real geometry/keyboard behavior is also checked
 * in the actual Electron document, not inferred from this fixture. */
class Node extends EventTarget {
  children: Node[] = []
  parent?: Node
  attributes = new Map<string, string>()
  dataset: Record<string, string> = {}
  className = ''; id = ''; hidden = false; tabIndex = 0; type = ''
  private text = ''
  constructor(readonly doc: Document, readonly tagName: string) { super() }
  set textContent(value: string) { this.text = value; this.children = [] }
  get textContent(): string { return this.text + this.children.map(c => c.textContent).join('') }
  setAttribute(key: string, value: string) { this.attributes.set(key, value) }
  getAttribute(key: string) { return this.attributes.get(key) ?? null }
  append(...children: Node[]) { for (const child of children) { child.parent = this; this.children.push(child) } }
  replaceChildren(...children: Node[]) { this.text = ''; this.children = []; this.append(...children) }
  contains(node: unknown): boolean { return this === node || this.children.some(c => c.contains(node)) }
  remove() { if (this.parent) this.parent.children = this.parent.children.filter(c => c !== this) }
  focus() { this.doc.activeElement = this }
  getByClass(name: string): Node | undefined { return this.className.split(' ').includes(name) ? this : this.children.map(c => c.getByClass(name)).find(Boolean) }
}
class Document extends EventTarget {
  head = new Node(this, 'head'); body = new Node(this, 'body'); activeElement: Node | null = null
  createElement(tag: string) { return new Node(this, tag) }
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe('independent advanced environment hint', () => {
  it('shows actual values without presenting detected Java as launch-ready', () => {
    const summary = environmentSummary(data, '/actual')
    expect(summary.title).toBe('Actual instance')
    expect(summary.rows.find(r => r.label === '分配内存')?.value).toBe('1024–2048 MB')
    expect(summary.rows.find(r => r.label === '后台任务')?.value).toBe('2 项进行中')
    expect(summary.rows.find(r => r.label === 'Java 运行时')?.value).toBe('自动选择 · 已发现 1 个')
    const explicit = structuredClone(data); explicit.instances[0].javaPath = '/missing'
    expect(environmentSummary(explicit).rows.find(r => r.label === 'Java 运行时')?.value).toBe('指定路径 · 尚未验证')
    explicit.instances[0].javaPath = '/java17'
    expect(environmentSummary(explicit).rows.find(r => r.label === 'Java 运行时')?.value).toBe('Java 17 · 17.0.1')
    expect(environmentSummary({ instances: [], javaRuntimes: [], accounts: [], tasks: [] }).rows.find(r => r.label === '加载器')?.value).toBe('未选择')
  })

  it('renders genuine configuration, restores focus on Escape, and disposes its own nodes', async () => {
    const document = new Document(), fetcher = vi.fn(async () => ({ ok: true, json: async () => data }))
    vi.stubGlobal('document', document); vi.stubGlobal('localStorage', { getItem: () => JSON.stringify('/actual') }); vi.stubGlobal('fetch', fetcher)
    const runtime = new FeatureRuntime(); runtime.register(plugin)
    try {
      await runtime.start()
      const trigger = document.body.getByClass('rh-advanced-trigger')!, panel = document.body.getByClass('rh-advanced-panel')!
      expect(panel.hidden).toBe(true)
      trigger.dispatchEvent(new Event('click'))
      await vi.waitFor(() => expect(panel.textContent).toContain('1024–2048 MB'))
      expect(panel.getAttribute('role')).toBe('dialog')
      expect(trigger.getAttribute('aria-expanded')).toBe('true')
      expect(document.activeElement?.getAttribute('aria-label')).toBe('关闭环境信息')
      document.dispatchEvent(Object.assign(new Event('keydown'), { key: 'Escape' }))
      expect(panel.hidden).toBe(true); expect(document.activeElement).toBe(trigger)
      trigger.dispatchEvent(new Event('click'))
      await vi.waitFor(() => expect(panel.textContent).toContain('Steve · 离线'))
      document.dispatchEvent(new Event('pointerdown'))
      expect(panel.hidden).toBe(true)
      await runtime.disable('ui.hints.advanced')
      expect(document.head.children).toHaveLength(0); expect(document.body.children).toHaveLength(0)
      await runtime.enable('ui.hints.advanced')
      expect(document.head.children).toHaveLength(1); expect(document.body.children).toHaveLength(2)
    } finally { await runtime.dispose() }
    expect(document.head.children).toHaveLength(0); expect(document.body.children).toHaveLength(0)
  })

  it('aborts closed requests and ignores a stale response after re-opening', async () => {
    const document = new Document(), requests: { signal: AbortSignal; resolve: (value: unknown) => void }[] = []
    vi.stubGlobal('document', document); vi.stubGlobal('localStorage', { getItem: () => '/actual' })
    vi.stubGlobal('fetch', vi.fn((_url, options) => new Promise(resolve => requests.push({ signal: options.signal, resolve }))))
    const runtime = new FeatureRuntime(); runtime.register(plugin)
    try {
      await runtime.start()
      const trigger = document.body.getByClass('rh-advanced-trigger')!, panel = document.body.getByClass('rh-advanced-panel')!
      trigger.dispatchEvent(new Event('click')); trigger.dispatchEvent(new Event('click'))
      expect(requests[0].signal.aborted).toBe(true)
      trigger.dispatchEvent(new Event('click'))
      const current = structuredClone(data); current.instances[0].name = 'Latest instance'
      requests[1].resolve({ ok: true, json: async () => current })
      await vi.waitFor(() => expect(panel.textContent).toContain('Latest instance'))
      requests[0].resolve({ ok: true, json: async () => data })
      await Promise.resolve(); await Promise.resolve()
      expect(panel.textContent).not.toContain('Actual instance')
      await runtime.disable('ui.hints.advanced')
      expect(requests[1].signal.aborted).toBe(true)
    } finally { await runtime.dispose() }
  })

  it('shows a failed read honestly instead of displaying an empty healthy environment', async () => {
    const document = new Document()
    vi.stubGlobal('document', document); vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false })))
    const runtime = new FeatureRuntime(); runtime.register(plugin)
    try {
      await runtime.start()
      document.body.getByClass('rh-advanced-trigger')!.dispatchEvent(new Event('click'))
      await vi.waitFor(() => expect(document.body.getByClass('rh-advanced-panel')!.textContent).toContain('暂时无法读取运行环境'))
      expect(document.body.getByClass('rh-advanced-stat')).toBeUndefined()
    } finally { await runtime.dispose() }
  })
})
