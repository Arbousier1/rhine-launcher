/**
 * Render smoke tests.
 *
 * These render the real pages to static markup with react-dom/server. They are
 * the cheapest guard against the failure mode that hurts most: a page that
 * compiles but throws on first paint. No DOM is required, and no API calls are
 * made because every data fetch happens inside an effect.
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router-dom'
import { createElement } from 'react'
import ArchivePage from '../src/pages/instances/ArchivePage.tsx'
import InstanceDetailPage from '../src/pages/instances/InstanceDetailPage.tsx'
import VersionsPage from '../src/pages/versions/VersionsPage.tsx'
import { AppRoutes } from '../src/app/routes.tsx'
import { ToastProvider } from '../src/ui/toast.tsx'
import { Button, Badge, Progress, Tabs, Field, Input, Switch, EmptyState, Skeleton, Sparkline, Panel, Tooltip } from '../src/ui/index.ts'

function render(node: Parameters<typeof renderToStaticMarkup>[0], path = '/'): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [path] }, node),
  )
}

describe('pages render without a backend', () => {
  it('hands archive navigation back to the native terminal without resurrecting the rejected tray', () => {
    const html = render(createElement(ArchivePage), '/')
    expect(html).toContain('游戏档案终端')
    expect(html).toContain('href="/"')
    expect(html).toContain('返回原生游戏档案')
    expect(html).not.toContain('rh-deck')
    expect(html).not.toContain('rh-archive-grid')
  })

  it('renders the versions page with its three tabs', () => {
    const html = render(createElement(VersionsPage), '/versions')
    expect(html).toContain('rh-versions')
    expect(html).toContain('远程版本')
    expect(html).toContain('已安装')
    expect(html).toContain('加载器')
  })

  it('renders the detail page with the missing-archive notice', () => {
    const html = render(createElement(InstanceDetailPage), '/instances/missing')
    expect(html).toContain('档案不存在')
  })

  it('renders the full route table for every shell destination', () => {
    for (const path of ['/', '/versions', '/mods', '/market', '/accounts', '/settings', '/java', '/logs']) {
      const html = render(createElement(AppRoutes), path)
      expect(html.length).toBeGreaterThan(0)
      expect(html).not.toContain('RENDER FAILURE')
    }
  })

  it('renders the toast provider with children', () => {
    const html = renderToStaticMarkup(
      createElement(ToastProvider, null, createElement('span', null, 'hello')),
    )
    expect(html).toContain('hello')
  })
})

describe('design system components render', () => {
  it('renders a primary button with a label', () => {
    const html = renderToStaticMarkup(createElement(Button, { variant: 'primary' }, '开始游戏'))
    expect(html).toContain('rh-btn--primary')
    expect(html).toContain('开始游戏')
  })

  it('renders a disabled loading button with a spinner', () => {
    const html = renderToStaticMarkup(createElement(Button, { loading: true }, '载入'))
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('disabled')
    expect(html).toContain('rh-spinner')
  })

  it('renders a panel with caption, title and actions', () => {
    const html = renderToStaticMarkup(
      createElement(
        Panel,
        { caption: 'SPEC', title: '规格', actions: createElement(Badge, null, '3') },
        'body',
      ),
    )
    expect(html).toContain('SPEC')
    expect(html).toContain('规格')
    expect(html).toContain('body')
  })

  it('renders tabs with the active marker', () => {
    const html = renderToStaticMarkup(
      createElement(Tabs, {
        value: 'b',
        onChange: () => undefined,
        items: [{ key: 'a', label: 'A' }, { key: 'b', label: 'B', count: 2 }],
      }),
    )
    expect(html).toContain('role="tablist"')
    expect(html).toContain('aria-selected="true"')
    expect(html).toContain('rh-tabs__marker')
  })

  it('renders a field with an error message', () => {
    const html = renderToStaticMarkup(
      createElement(Field, { label: '名称', error: '必填' }, createElement(Input, { value: 'x', readOnly: true })),
    )
    expect(html).toContain('名称')
    expect(html).toContain('必填')
    expect(html).toContain('role="alert"')
  })

  it('renders a switch in both states', () => {
    const on = renderToStaticMarkup(createElement(Switch, { checked: true }))
    const off = renderToStaticMarkup(createElement(Switch, { checked: false }))
    expect(on).toContain('aria-checked="true"')
    expect(off).toContain('aria-checked="false"')
  })

  it('renders determinate and indeterminate progress', () => {
    const known = renderToStaticMarkup(createElement(Progress, { value: 0.42, label: '下载中' }))
    expect(known).toContain('42%')
    expect(known).toContain('aria-valuenow="42"')

    const unknown = renderToStaticMarkup(createElement(Progress, { value: -1 }))
    expect(unknown).toContain('is-indeterminate')
    expect(unknown).not.toContain('aria-valuenow')
  })

  it('renders an empty state with an action', () => {
    const html = renderToStaticMarkup(
      createElement(EmptyState, {
        title: '没有内容',
        description: '先创建一个吧',
        action: createElement(Button, null, '新建'),
      }),
    )
    expect(html).toContain('没有内容')
    expect(html).toContain('先创建一个吧')
    expect(html).toContain('新建')
  })

  it('renders skeleton lines', () => {
    const html = renderToStaticMarkup(createElement(Skeleton, { lines: 3 }))
    expect(html.match(/rh-skeleton"/g)?.length).toBe(3)
  })

  it('renders a sparkline polyline for real data', () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { data: [1, 4, 2, 8] }))
    expect(html).toContain('<svg')
    expect(html).toContain('<path')
  })

  it('renders an empty sparkline placeholder', () => {
    const html = renderToStaticMarkup(createElement(Sparkline, { data: [1] }))
    expect(html).toContain('is-empty')
  })

  it('renders a tooltip host without the bubble until hovered', () => {
    const html = renderToStaticMarkup(
      createElement(Tooltip, { content: '提示' }, createElement('span', null, 'anchor')),
    )
    expect(html).toContain('anchor')
    expect(html).not.toContain('role="tooltip"')
  })
})
