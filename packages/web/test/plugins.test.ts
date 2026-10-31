/**
 * Web feature plugin tests.
 *
 * The contract is "one feature, one capability, one lifecycle". These tests
 * pin down the two properties that matter for the UI:
 * 1. disabling one feature never touches unrelated siblings;
 * 2. a broken feature is rolled back alone, and every effect cleanup runs
 *    through env.onDispose().
 * The last block renders the real host with a mutated registry, which is the
 * guard that disabled pages/motions stay server-renderable (no blank screens).
 */
import { describe, expect, it } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { MemoryRouter } from 'react-router-dom'
import { defineFeature } from '../src/plugins/define.ts'
import { createFeatureRegistry } from '../src/plugins/registry.ts'
import type { StorageLike, WebFeatureRegistry } from '../src/plugins/registry.ts'
import { WEB_CATALOG, installWebFeatures } from '../src/plugins/catalog.ts'
import { WebPluginContext } from '../src/plugins/hooks.ts'
import { PluginSlot } from '../src/plugins/slots.tsx'
import { AppRoutes } from '../src/app/routes.tsx'
import { App } from '../src/app/App.tsx'
import { WebFeatureError } from '../src/plugins/types.ts'
import type { WebFeature } from '../src/plugins/types.ts'

function memoryStorage(): StorageLike & { dump(): string } {
  const map = new Map<string, string>()
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => {
      map.set(key, value)
    },
    dump: () => [...map.values()].join('\n'),
  }
}

function freshRegistry(storage: StorageLike | null = null): WebFeatureRegistry {
  return createFeatureRegistry({ storage })
}

function fixture(overrides: Partial<WebFeature> = {}): WebFeature {
  return {
    id: 'fixture.one',
    capability: 'fixture.one',
    title: 'fixture',
    kind: 'motion',
    slot: 'fixture.slot',
    render: () => null,
    ...overrides,
  } as WebFeature
}

function ssr(registry: WebFeatureRegistry, node: Parameters<typeof renderToStaticMarkup>[0], path = '/'): string {
  return renderToStaticMarkup(
    createElement(
      WebPluginContext.Provider,
      { value: registry },
      createElement(MemoryRouter, { initialEntries: [path] }, node),
    ),
  )
}

describe('defineFeature contract', () => {
  it('defaults capability to the id and freezes the dependency lists', () => {
    const feature = defineFeature({
      id: 'motion.test',
      title: 'test',
      kind: 'motion',
      slot: 'motion.test',
      render: () => null,
      depends: ['view.archive'],
      optionalDepends: ['motion.dust'],
    })
    expect(feature.capability).toBe('motion.test')
    expect(Object.isFrozen(feature)).toBe(true)
    expect(Object.isFrozen(feature.depends)).toBe(true)
    expect(feature.depends).toEqual(['view.archive'])
  })

  it('rejects a second capability', () => {
    expect(() =>
      defineFeature({ id: 'a.b', capability: 'a.c', title: 'x', kind: 'effect', setup() {} } as never),
    ).toThrow(/capability/)
  })

  it('rejects batch registration fields', () => {
    expect(() =>
      defineFeature({
        id: 'a.b',
        title: 'x',
        kind: 'effect',
        setup() {},
        routes: ['/a'],
      } as never),
    ).toThrow(/batch-register/)
  })

  it('requires a route for views and a slot for motion', () => {
    expect(() => defineFeature({ id: 'v.a', title: 'x', kind: 'view', render: () => null } as never)).toThrow(
      /route/,
    )
    expect(() => validateMotion()).toThrow(/slot/)
  })

  it('rejects malformed ids and self dependencies', () => {
    expect(() => defineFeature({ id: 'Bad Id', title: 'x', kind: 'effect', setup() {} })).toThrow(
      /lowercase dotted/,
    )
    expect(() =>
      defineFeature({ id: 'a.b', title: 'x', kind: 'effect', setup() {}, depends: ['a.b'] }),
    ).toThrow(/invalid dependency/)
  })
})

function validateMotion(): unknown {
  return defineFeature({ id: 'motion.x', title: 'x', kind: 'motion', render: () => null } as never)
}

describe('catalog discovery', () => {
  it('registers every single-feature plugin from the filesystem', () => {
    expect(WEB_CATALOG.failed).toEqual([])
    expect(WEB_CATALOG.registered).toContain('view.archive')
    expect(WEB_CATALOG.registered).toContain('view.plugins')
    expect(WEB_CATALOG.registered).toContain('motion.archive-core')
    expect(WEB_CATALOG.registered).toContain('motion.failsafe')
    expect(WEB_CATALOG.registered).toContain('shell.theme-cycle')
    expect(WEB_CATALOG.registered).toContain('shell.sessions')
    expect(WEB_CATALOG.registered).toContain('ui.toasts')
    expect(new Set(WEB_CATALOG.registered).size).toBe(WEB_CATALOG.registered.length)
  })

  it('gives every registered feature exactly its own capability', () => {
    const registry = freshRegistry()
    installWebFeatures(registry)
    for (const entry of registry.list()) {
      expect(entry.capability).toBe(entry.id)
      expect(entry.kind).not.toBeUndefined()
    }
  })

  it('reports duplicates instead of registering them twice', () => {
    const registry = freshRegistry()
    installWebFeatures(registry)
    const second = installWebFeatures(registry)
    expect(second.registered).toHaveLength(0)
    expect(second.failed.length).toBe(WEB_CATALOG.registered.length)
  })
})

describe('registry lifecycle', () => {
  it('keeps the snapshot identity stable between mutations', () => {
    const registry = freshRegistry()
    registry.register(fixture({ id: 'fixture.a', capability: 'fixture.a' }))
    const snapshot = registry.snapshot()
    expect(registry.snapshot()).toBe(snapshot)
    expect(registry.getSnapshot()).toBe(snapshot)
    expect(registry.getState()).toBe(snapshot)

    let calls = 0
    let received: unknown = null
    const off = registry.subscribe((next) => {
      calls += 1
      received = next
    })
    registry.register(fixture({ id: 'fixture.b', capability: 'fixture.b' }))
    expect(calls).toBe(1)
    expect(received).toBe(registry.snapshot())
    expect(registry.snapshot()).not.toBe(snapshot)
    off()
    registry.register(fixture({ id: 'fixture.c', capability: 'fixture.c' }))
    expect(calls).toBe(1)
  })

  it('disables one feature without touching unrelated siblings', async () => {
    const registry = freshRegistry()
    installWebFeatures(registry)
    const viewsBefore = registry.list().filter((entry) => entry.kind === 'view' && entry.status === 'enabled')

    await registry.disable('motion.dust')

    expect(registry.has('motion.dust')).toBe(false)
    expect(registry.has('motion.scanline')).toBe(true)
    expect(registry.has('motion.boot')).toBe(true)
    expect(registry.has('view.archive')).toBe(true)
    expect(registry.list().filter((entry) => entry.kind === 'view' && entry.status === 'enabled')).toEqual(
      viewsBefore,
    )
  })

  it('cascades to hard dependents but never to optional ones', async () => {
    const registry = freshRegistry()
    registry.register(fixture({ id: 'fixture.base', capability: 'fixture.base', kind: 'effect', slot: undefined, render: undefined, setup() {} }))
    registry.register(fixture({ id: 'fixture.child', capability: 'fixture.child', depends: ['fixture.base'] }))
    registry.register(
      fixture({ id: 'fixture.optional', capability: 'fixture.optional', optionalDepends: ['fixture.base'] }),
    )

    await registry.disable('fixture.base')

    expect(registry.has('fixture.base')).toBe(false)
    expect(registry.has('fixture.child')).toBe(false)
    expect(registry.has('fixture.optional')).toBe(true)
  })

  it('pulls required dependencies back in on enable', async () => {
    const registry = freshRegistry()
    registry.register(fixture({ id: 'fixture.base', capability: 'fixture.base', kind: 'effect', slot: undefined, render: undefined, setup() {} }))
    registry.register(fixture({ id: 'fixture.child', capability: 'fixture.child', depends: ['fixture.base'] }))
    await registry.disable('fixture.base')
    expect(registry.has('fixture.child')).toBe(false)

    await registry.enable('fixture.child')

    expect(registry.has('fixture.child')).toBe(true)
    expect(registry.has('fixture.base')).toBe(true)
  })

  it('rolls back only the feature whose setup throws', async () => {
    const registry = freshRegistry()
    registry.register(fixture({ id: 'fixture.ok', capability: 'fixture.ok', kind: 'effect', slot: undefined, render: undefined, setup() {} }))
    registry.register(
      fixture({
        id: 'fixture.broken',
        capability: 'fixture.broken',
        kind: 'effect',
        slot: undefined,
        render: undefined,
        setup() {
          throw new Error('boom')
        },
      }),
    )
    await registry.start()

    const broken = registry.snapshot().byId['fixture.broken']
    expect(broken.status).toBe('failed')
    expect(broken.error).toContain('boom')
    expect(registry.has('fixture.broken')).toBe(false)
    expect(registry.has('fixture.ok')).toBe(true)
    expect(registry.snapshot().byId['fixture.ok'].status).toBe('enabled')
  })

  it('runs env.onDispose cleanup on disable', async () => {
    const registry = freshRegistry()
    let disposed = 0
    registry.register(
      fixture({
        id: 'fixture.effect',
        capability: 'fixture.effect',
        kind: 'effect',
        slot: undefined,
        render: undefined,
        setup(env) {
          env.onDispose(() => {
            disposed += 1
          })
        },
      }),
    )
    await registry.start()
    expect(disposed).toBe(0)
    await registry.disable('fixture.effect')
    expect(disposed).toBe(1)
  })

  it('blocks call() on a disabled capability and undeclared env.use()', async () => {
    const registry = freshRegistry()
    registry.register(
      fixture({
        id: 'fixture.call',
        capability: 'fixture.call',
        kind: 'effect',
        slot: undefined,
        render: undefined,
        execute: () => 'result',
      }),
    )
    registry.register(
      fixture({
        id: 'fixture.undeclared',
        capability: 'fixture.undeclared',
        kind: 'effect',
        slot: undefined,
        render: undefined,
        setup(env) {
          env.use('fixture.call')
        },
      }),
    )

    await registry.start()

    expect(registry.call('fixture.call')).toBe('result')
    const entry = registry.snapshot().byId['fixture.undeclared']
    expect(entry.status).toBe('failed')
    expect(entry.error).toMatch(/没有声明依赖/)

    await registry.disable('fixture.call')
    expect(() => registry.call('fixture.call')).toThrow(WebFeatureError)
    expect(() => registry.call('missing.feature')).toThrow(/找不到功能插件/)
  })

  it('persists the disabled set and restores it for the next registry', async () => {
    const storage = memoryStorage()
    const registry = freshRegistry(storage)
    installWebFeatures(registry)
    await registry.disable('motion.dust')
    expect(storage.dump()).toContain('motion.dust')

    const restored = freshRegistry(storage)
    installWebFeatures(restored)
    expect(restored.has('motion.dust')).toBe(false)
    expect(restored.has('motion.scanline')).toBe(true)
  })

  it('rejects registering the same id twice', () => {
    const registry = freshRegistry()
    registry.register(fixture({ id: 'fixture.dup', capability: 'fixture.dup' }))
    expect(() => registry.register(fixture({ id: 'fixture.dup', capability: 'fixture.dup' }))).toThrow(
      /已经注册|功能已注册/,
    )
  })

  it('seeds state only once', () => {
    const registry = freshRegistry()
    registry.seedState('fixture.state', { ok: true })
    expect(registry.state('fixture.state', () => ({ ok: false }))).toEqual({ ok: true })
    expect(() => registry.seedState('fixture.state', 1)).toThrow(WebFeatureError)
  })
})

describe('host renders with plugins toggled (SSR)', () => {
  it('renders every route with the full catalog', () => {
    const registry = freshRegistry()
    installWebFeatures(registry)
    const home = ssr(registry, createElement(AppRoutes), '/')
    expect(home).toContain('返回原生游戏档案')
    expect(home).toContain('href="/"')
    expect(home).not.toContain('rh-deck')
  })

  it('keeps the page mounted when the archive core and dust are disabled', async () => {
    const registry = freshRegistry()
    installWebFeatures(registry)
    await registry.disable('motion.archive-core')
    await registry.disable('motion.dust')

    const html = ssr(registry, createElement(AppRoutes), '/')

    expect(html).toContain('返回原生游戏档案')
    expect(html).toContain('href="/"')
    expect(html).not.toContain('rh-core')
    expect(html).not.toContain('rh-dust')
  })

  it('renders the shell without the boot overlay when motion.boot is disabled', async () => {
    const registry = freshRegistry()
    installWebFeatures(registry)
    await registry.disable('motion.boot')

    const html = ssr(registry, createElement(App, null, createElement(AppRoutes)), '/')

    expect(html).toContain('rh-shell')
    expect(html).toContain('rh-nav')
    expect(html).not.toContain('rh-boot')
    expect(html).not.toContain('rh-curtain')
  })

  it('shows the recoverable notice when a view plugin is disabled', async () => {
    const registry = freshRegistry()
    installWebFeatures(registry)
    await registry.disable('view.versions')

    const disabled = ssr(registry, createElement(AppRoutes), '/versions')
    expect(disabled).toContain('PLUGIN DISABLED')
    expect(disabled).toContain('view.versions')

    const archive = ssr(registry, createElement(AppRoutes), '/')
    expect(archive).toContain('返回原生游戏档案')
  })

  it('falls back to plain text when the decrypt motion is disabled', async () => {
    const registry = freshRegistry()
    registry.register(
      fixture({
        id: 'motion.text-decrypt',
        capability: 'motion.text-decrypt',
        kind: 'motion',
        slot: 'motion.text-decrypt',
        render: () => createElement('em', null, 'SCRAMBLED'),
      }),
    )
    await registry.disable('motion.text-decrypt')

    const html = ssr(
      registry,
      createElement(PluginSlot, {
        name: 'motion.text-decrypt',
        props: { text: '档案标题' },
        fallback: createElement('span', null, '档案标题'),
      }),
    )
    expect(html).toContain('档案标题')
    expect(html).not.toContain('SCRAMBLED')
  })

  it('renders a contributed slot when the feature is enabled', () => {
    const registry = freshRegistry()
    registry.register(
      fixture({
        id: 'motion.text-decrypt',
        capability: 'motion.text-decrypt',
        kind: 'motion',
        slot: 'motion.text-decrypt',
        render: () => createElement('em', null, 'SCRAMBLED'),
      }),
    )
    const html = ssr(
      registry,
      createElement(PluginSlot, { name: 'motion.text-decrypt', props: { text: 'x' }, fallback: 'PLAIN' }),
    )
    expect(html).toContain('SCRAMBLED')
  })
})