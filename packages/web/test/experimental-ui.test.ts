/**
 * Experimental archive terminal plugin (archive.ui.experimental).
 *
 * The terminal is a three.js scene, so ../main is mocked here: these tests pin the
 * plugin's lifecycle contract only — never a WebGL canvas.
 * 1. the feature is opt-in and disabled by default;
 * 2. one enabled era mounts the terminal exactly once and never twice;
 * 3. disable/unload tears the mount down and a later enable mounts once again;
 * 4. execution aborts before mountConsole when its signal is aborted;
 * 5. the plugin adds no global listeners of its own — everything observed comes
 *    from the mocked mountConsole, which owns what it registers.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { FeatureRuntime, FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import plugin from '../src/console/experimental/experimental-ui.plugin'

const h = vi.hoisted(() => ({ mounts: 0, imported: 0 }))

// Never a WebGL scene: the scene module is replaced by a counting stub, so a
// disabled feature provably costs nothing and an enabled one mounts once.
vi.mock('../src/console/main', () => {
  h.imported += 1
  return {
  mountConsole: (env: { onDispose?: (dispose: () => void) => void }) => {
    h.mounts += 1
    // Stand-in for the real terminal: it acquires its own window listener and
    // releases it through the host fiber, exactly like ../runtime-effects.ts.
    const target = (globalThis as unknown as { window: EventTarget }).window
    const onResize = () => {}
    target.addEventListener('resize', onResize)
    env.onDispose?.(() => target.removeEventListener('resize', onResize))
  },
  }
})

const ID = 'archive.ui.experimental'

/** Window and document stubs: any global listener a plugin adds is observable. */
function fakeTargets() {
  const window = new EventTarget()
  const document = new EventTarget()
  const added = vi.spyOn(window, 'addEventListener')
  const removed = vi.spyOn(window, 'removeEventListener')
  const docAdded = vi.spyOn(document, 'addEventListener')
  vi.stubGlobal('window', window)
  vi.stubGlobal('document', document)
  return { window, document, added, removed, docAdded }
}

function started(options: { disabled?: readonly string[] } = {}) {
  const runtime = new FeatureRuntime()
  runtime.register(plugin)
  return { runtime, ready: runtime.start(options) }
}

/** Minimal environment so the plugin's own cancellation path can be driven directly. */
function directEnv(signal: AbortSignal) {
  const states = new Map<string, unknown>()
  const disposers: (() => void)[] = []
  const env = {
    signal,
    state<T>(key: string, init: () => T): T {
      if (!states.has(key)) states.set(key, init())
      return states.get(key) as T
    },
    onDispose(dispose: () => void) {
      disposers.push(dispose)
    },
  } as unknown as FeatureEnvironment
  return { env, disposeAll: () => disposers.forEach((dispose) => dispose()) }
}

beforeEach(() => {
  h.mounts = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('archive.ui.experimental plugin contract', () => {
  it('is one capability whose id, capability and single execute agree', () => {
    expect(plugin.id).toBe(ID)
    expect(plugin.capability).toBe(ID)
    expect(typeof plugin.execute).toBe('function')
    // A plugin may never describe a collection of capabilities.
    for (const key of ['capabilities', 'features', 'routes', 'plugins']) expect(key in plugin).toBe(false)
    const runtime = new FeatureRuntime()
    runtime.register(plugin)
    expect(runtime.definitions().map((definition) => definition.id)).toEqual([ID])
    expect(runtime.definitions()[0].capability).toBe(ID)
  })

  it('declares only relationships, including the eager terminal it supersedes', () => {
    expect(plugin.depends ?? []).toEqual([])
    const optional = [...(plugin.optionalDepends ?? [])]
    expect(optional).toContain('console.ui.mount')
    expect(optional).toContain('renderer.webgl.create')
    expect(optional).toContain('panel.accounts')
    expect(new Set(optional).size).toBe(optional.length)
    expect(optional).not.toContain(ID)
    expect(plugin.title).toMatch(/[\u4e00-\u9fff]/)
  })

  it('stays disabled and mounts nothing when started with it disabled', async () => {
    const targets = fakeTargets()
    const { runtime, ready } = started({ disabled: [ID] })
    try {
      await ready
      expect(runtime.get(ID)?.status).toBe('disabled')
      expect(runtime.has(ID)).toBe(false)
      expect(() => runtime.call(ID)).toThrow(FeatureError)
      expect(h.mounts).toBe(0)
      // The scene module is never even imported while the feature is disabled.
      expect(h.imported).toBe(0)
      expect(targets.added).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
    }
  })
})

describe('archive.ui.experimental mount lifecycle', () => {
  it('mounts exactly once per enabled era even when enable and call repeat', async () => {
    const targets = fakeTargets()
    const { runtime, ready } = started()
    try {
      await ready
      expect(runtime.get(ID)?.status).toBe('enabled')
      expect(h.mounts).toBe(0) // enabling is not executing

      expect(h.imported).toBe(0) // enabling alone still loads no scene code
      const first = await runtime.call<Promise<{ dispose(): void }>>(ID)
      expect(h.mounts).toBe(1)
      expect(h.imported).toBe(1)

      await runtime.enable(ID)
      const second = await runtime.call<Promise<{ dispose(): void }>>(ID)
      expect(h.mounts).toBe(1)
      expect(second).toBe(first)

      // Every global listener observed belongs to the mocked terminal itself.
      expect(targets.added).toHaveBeenCalledTimes(h.mounts)
      expect(targets.docAdded).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
    }
  })

  it('shares one in-flight mount between concurrent callers', async () => {
    fakeTargets()
    const { runtime, ready } = started()
    try {
      await ready
      const [a, b] = await Promise.all([
        runtime.call<Promise<{ dispose(): void }>>(ID),
        runtime.call<Promise<{ dispose(): void }>>(ID),
      ])
      expect(h.mounts).toBe(1)
      expect(a).toBe(b)
    } finally {
      await runtime.dispose()
    }
  })

  it('disposes on disable and mounts once again on a later enable, never accumulating', async () => {
    const targets = fakeTargets()
    const { runtime, ready } = started()
    try {
      await ready
      const first = await runtime.call<Promise<{ dispose(): void }>>(ID)
      const disposed = vi.spyOn(first, 'dispose')
      expect(h.mounts).toBe(1)

      await runtime.disable(ID)
      expect(disposed).toHaveBeenCalledTimes(1)
      expect(runtime.has(ID)).toBe(false)
      expect(targets.removed).toHaveBeenCalledTimes(1)

      await runtime.enable(ID)
      const second = await runtime.call<Promise<{ dispose(): void }>>(ID)
      expect(h.mounts).toBe(2)
      expect(second).not.toBe(first)

      await runtime.disable(ID)
      await runtime.enable(ID)
      await runtime.call<Promise<{ dispose(): void }>>(ID)
      expect(h.mounts).toBe(3)
      // One mount and one listener per era, each released: nothing accumulates.
      expect(targets.added).toHaveBeenCalledTimes(3)
      expect(targets.removed).toHaveBeenCalledTimes(2)
    } finally {
      await runtime.dispose()
    }
  })

  it('unloads the terminal when the host runtime is disposed', async () => {
    fakeTargets()
    const { runtime, ready } = started()
    await ready
    await runtime.call<Promise<{ dispose(): void }>>(ID)
    expect(h.mounts).toBe(1)
    await runtime.dispose()
    expect(runtime.has(ID)).toBe(false)
    expect(plugin.execute).toBeTypeOf('function')
  })
})

describe('archive.ui.experimental cancellation', () => {
  it('never imports or mounts when the caller signal is already aborted', async () => {
    const targets = fakeTargets()
    const { runtime, ready } = started()
    try {
      await ready
      const controller = new AbortController()
      controller.abort()
      // The host rejects a pre-aborted call before execute() runs.
      expect(() => runtime.call(ID, undefined, { signal: controller.signal })).toThrow(FeatureError)
      expect(h.mounts).toBe(0)
      expect(targets.added).not.toHaveBeenCalled()
    } finally {
      await runtime.dispose()
    }
  })

  it('rejects promptly when aborted while the lazy import is in flight', async () => {
    fakeTargets()
    const { runtime, ready } = started()
    try {
      await ready
      const controller = new AbortController()
      const pending = runtime.call<Promise<unknown>>(ID, undefined, { signal: controller.signal })
      controller.abort()
      await expect(pending).rejects.toMatchObject({ code: 'PLUGIN_CANCELLED' })
      await Promise.resolve()
      await Promise.resolve()
      expect(h.mounts).toBe(0)
    } finally {
      await runtime.dispose()
    }
  })

  it('honours the fiber signal after the dynamic import resolves', async () => {
    fakeTargets()
    const controller = new AbortController()
    const { env, disposeAll } = directEnv(controller.signal)
    // Abort before execute() settles, then let the microtask queue drain so the
    // plugin reaches its post-import re-check.
    const pending = plugin.execute(undefined, env)
    controller.abort()
    await expect(pending).rejects.toThrow()
    expect(h.mounts).toBe(0)
    disposeAll()
    expect(h.mounts).toBe(0)
  })

  it('does not remount a handle whose era already ended', async () => {
    fakeTargets()
    const controller = new AbortController()
    const { env, disposeAll } = directEnv(controller.signal)
    plugin.setup?.(env)
    const handle = await plugin.execute(undefined, env)
    expect(h.mounts).toBe(1)

    // A disable retires the era: the setup inverse runs once, then the fiber aborts.
    disposeAll()
    controller.abort()
    handle.dispose()
    handle.dispose()
    expect(h.mounts).toBe(1)
  })
})
