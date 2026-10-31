/**
 * Web feature registry — the browser twin of FeatureRuntime.
 *
 * Same vocabulary as @rhine/plugin-api: register / start / enable / disable /
 * call / has / list / state / seedState / snapshot / subscribe / dispose.
 * The snapshot is deeply frozen and its identity only changes when the registry
 * changes, so `useSyncExternalStore(registry.subscribe, registry.snapshot)` is
 * stable. `subscribe` also hands the fresh snapshot to the listener, matching
 * the Cordis runtime.
 *
 * Semantics that matter for the UI:
 * - a registered feature is renderable immediately (unlike the node runtime,
 *   which waits for start()); start() only mounts setup() effects;
 * - disabling one feature never touches unrelated siblings — only hard
 *   `depends` dependents are unloaded (and marked blocked), exactly like the
 *   node runtime; `optionalDepends` never cascades;
 * - every effect cleanup goes through `env.onDispose()` and runs on disable,
 *   on a failed setup (rollback) and on dispose().
 */
import { WebFeatureError } from './types.ts'
import { Context } from '@deepseek-ai/cordis'
import type {
  WebFeature, WebFeatureEntry, WebFeatureEnvironment, WebFeatureSnapshot, WebFeatureStatus, WebNavEntry,
} from './types.ts'

const DEFAULT_STORAGE_KEY = 'rhine.web.features'

export interface StorageLike {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface FeatureRegistryOptions {
  storage?: StorageLike | null
  storageKey?: string
  logger?: Pick<Console, 'warn'>
}

interface RegisterRecord {
  feature: WebFeature
  source?: string
  order: number
}

interface StateRecord {
  value: unknown
  cleanup?: (value: unknown) => void | Promise<void>
}

const EMPTY_SNAPSHOT: WebFeatureSnapshot = {
  revision: 0,
  features: [],
  byId: {},
  slots: {},
  views: [],
  routes: [],
  nav: { main: [], aux: [] },
}

function browserStorage(): StorageLike | null {
  if (typeof window === 'undefined') return null
  try {
    return window.localStorage ?? null
  } catch {
    return null
  }
}

function compareEntries(a: { order: number; id: string }, b: { order: number; id: string }): number {
  return a.order - b.order || a.id.localeCompare(b.id)
}

export class WebFeatureRegistry {
  /** Each view/action/effect owns a real, independently disposable Cordis fiber. */
  readonly context = new Context()
  private readonly fibers = new Map<string,{dispose():Promise<void>}>()
  private readonly scopeContexts = new Map<string,Context>()
  private readonly records = new Map<string, RegisterRecord>()
  private readonly enabled = new Set<string>()
  private readonly failures = new Map<string, string>()
  private readonly loading = new Set<string>()
  private readonly listeners = new Set<(snapshot: WebFeatureSnapshot) => void>()
  private readonly controllers = new Map<string, AbortController>()
  private readonly disposers = new Map<string, Array<() => void | Promise<void>>>()
  private readonly states = new Map<string, StateRecord>()
  private readonly storage: StorageLike | null
  private readonly storageKey: string
  private readonly logger: Pick<Console, 'warn'>
  private persistedDisabled = new Set<string>()
  private snapshotValue: WebFeatureSnapshot = EMPTY_SNAPSHOT
  private revision = 0
  private booted = false
  private disposed = false

  constructor(options: FeatureRegistryOptions = {}) {
    this.storage = options.storage === undefined ? browserStorage() : options.storage
    this.storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY
    this.logger = options.logger ?? (typeof console === 'undefined' ? { warn() {} } : console)
    this.persistedDisabled = this.readPersistedDisabled()
  }

  /* ---------------------------------------------------------------- */
  /* registration                                                      */
  /* ---------------------------------------------------------------- */

  register(feature: WebFeature, source?: string): void {
    if (this.disposed) throw new WebFeatureError('HOST_DISPOSED', 'registry already disposed')
    if (!feature?.id) throw new WebFeatureError('INVALID_PLUGIN', 'cannot register a feature without an id')
    if (feature.capability !== feature.id) {
      throw new WebFeatureError(
        'MULTIPLE_CAPABILITIES',
        `${feature.id} advertises capability "${feature.capability}"`,
      )
    }
    if (this.records.has(feature.id)) {
      throw new WebFeatureError('DUPLICATE_CAPABILITY', '功能已注册：' + feature.id)
    }
    this.records.set(feature.id, {
      feature,
      source,
      order: feature.order ?? feature.route?.order ?? 100,
    })
    if (!this.persistedDisabled.has(feature.id)) this.enabled.add(feature.id)
    this.publish()
  }

  registerAll(features: readonly WebFeature[], source?: string): void {
    for (const feature of features) this.register(feature, source)
  }

  /** Registered (regardless of state). */
  defines(id: string): boolean {
    return this.records.has(id)
  }

  /** Enabled and healthy — the same meaning as FeatureRuntime.has(). */
  has(id: string): boolean {
    return this.available(id,new Set())
  }

  get(id: string): WebFeatureEntry | undefined {
    return this.snapshotValue.byId[id]
  }

  definition(id: string): WebFeature | undefined {
    return this.records.get(id)?.feature
  }

  list(): readonly WebFeatureEntry[] {
    return this.snapshotValue.features
  }

  configuration(): { disabled: string[] } {
    return { disabled: [...this.records.keys()].filter((id) => !this.enabled.has(id)) }
  }

  /* ---------------------------------------------------------------- */
  /* lifecycle                                                         */
  /* ---------------------------------------------------------------- */

  /** Mount setup() for every enabled feature. Idempotent; safe before render. */
  async start(options: { disabled?: readonly string[] } = {}): Promise<void> {
    if (this.disposed) throw new WebFeatureError('HOST_DISPOSED', 'registry already disposed')
    if (options.disabled?.length) {
      for (const id of options.disabled) this.enabled.delete(id)
      this.persist()
      this.publish()
    }
    this.booted = true
    for (const id of [...this.enabled]) {
      await this.runSetup(id)
    }
  }

  async enable(id: string): Promise<void> {
    this.assertAlive()
    const record = this.records.get(id)
    if (!record) throw new WebFeatureError('PLUGIN_NOT_FOUND', '找不到功能插件：' + id)
    this.failures.delete(id)
    this.persistedDisabled.delete(id)
    for (const depId of this.requiredClosure(id)) this.enabled.add(depId)
    this.persist()
    this.publish()
    if (this.booted) {
      for (const depId of this.requiredClosure(id)) await this.runSetup(depId)
    }
    // Dependents that were blocked by this feature come back automatically.
    for (const entry of this.snapshotValue.features) {
      if (entry.status === 'blocked' || entry.error) {
        const deps = entry.depends
        if (deps.length > 0 && deps.every((dep) => this.enabled.has(dep) && !this.failures.has(dep))) {
          this.enabled.add(entry.id)
          if (this.booted) await this.runSetup(entry.id)
        }
      }
    }
    this.publish()
    const status = this.snapshotValue.byId[id]?.status
    if (status !== 'enabled') {
      throw new WebFeatureError('PLUGIN_BLOCKED', this.snapshotValue.byId[id]?.error ?? '插件未能启用：' + id)
    }
  }

  async disable(id: string): Promise<void> {
    this.assertAlive()
    if (!this.records.has(id)) throw new WebFeatureError('PLUGIN_NOT_FOUND', '找不到功能插件：' + id)
    const doomed = this.dependentsOf(id)
    this.enabled.delete(id)
    this.persistedDisabled.add(id)
    for (const doomedId of doomed) await this.stop(doomedId)
    this.persist()
    this.publish()
  }

  async toggle(id: string, next?: boolean): Promise<boolean> {
    const target = next ?? !this.enabled.has(id)
    if (target) {
      await this.enable(id)
      return true
    }
    await this.disable(id)
    return false
  }

  /** A render-time crash: shown as failed, never silently enabled. */
  reportFailure(id: string, error: unknown): void {
    if (!this.records.has(id)) return
    this.failures.set(id, error instanceof Error ? error.message : String(error))
    void this.stop(id).finally(()=>this.publish())
    this.publish()
  }

  clearFailure(id: string): void {
    if (this.failures.delete(id)) this.publish()
  }

  async dispose(): Promise<void> {
    if (this.disposed) return
    const disposed = new Set<string>()
    for (const id of this.records.keys()) for(const child of this.dependentsOf(id)){if(disposed.has(child))continue;disposed.add(child);await this.stop(child)}
    this.enabled.clear()
    this.publish()
    for (const record of [...this.states.values()].reverse()) {
      if (record.cleanup) await record.cleanup(record.value)
    }
    this.states.clear()
    this.listeners.clear()
    this.disposed = true
    this.booted = false
  }

  /* ---------------------------------------------------------------- */
  /* capability calls                                                  */
  /* ---------------------------------------------------------------- */

  call<T = unknown>(id: string, input?: unknown): T {
    this.assertAlive()
    const record = this.records.get(id)
    if (!record) throw new WebFeatureError('PLUGIN_NOT_FOUND', '找不到功能插件：' + id)
    if (!this.has(id)) {
      throw new WebFeatureError('PLUGIN_UNAVAILABLE', this.failures.get(id) ?? '功能插件未启用：' + id)
    }
    const execute = record.feature.execute
    if (!execute) throw new WebFeatureError('PLUGIN_UNAVAILABLE', '功能没有 execute：' + id)
    const controller = this.controllers.get(id)
    return execute(input, this.createEnvironment(id, controller?.signal ?? new AbortController().signal)) as T
  }

  state<T>(key: string, init: () => T, cleanup?: (value: T) => void | Promise<void>): T {
    const known = this.states.get(key)
    if (known) return known.value as T
    const value = init()
    this.states.set(key, { value, cleanup: cleanup as StateRecord['cleanup'] })
    return value
  }

  hasState(key: string): boolean {
    return this.states.has(key)
  }

  seedState<T>(key: string, value: T): void {
    if (this.states.has(key)) throw new WebFeatureError('DUPLICATE_STATE', '宿主状态已初始化：' + key)
    this.states.set(key, { value })
  }

  /* ---------------------------------------------------------------- */
  /* subscription                                                      */
  /* ---------------------------------------------------------------- */

  subscribe = (listener: (snapshot: WebFeatureSnapshot) => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  snapshot = (): WebFeatureSnapshot => this.snapshotValue

  getSnapshot = (): WebFeatureSnapshot => this.snapshotValue

  getState = (): WebFeatureSnapshot => this.snapshotValue

  getServerSnapshot = (): WebFeatureSnapshot => this.snapshotValue

  /* ---------------------------------------------------------------- */
  /* internals                                                         */
  /* ---------------------------------------------------------------- */

  private assertAlive(): void {
    if (this.disposed) throw new WebFeatureError('HOST_DISPOSED', 'registry already disposed')
  }

  private requiredClosure(id: string): string[] {
    const closure: string[] = []
    const seen = new Set<string>()
    const visit = (current: string, trail: string[]) => {
      if (seen.has(current)) return
      if (trail.includes(current)) {
        throw new WebFeatureError('DEPENDENCY_CYCLE', '插件依赖存在循环：' + [...trail, current].join(' → '))
      }
      const record = this.records.get(current)
      if (!record) throw new WebFeatureError('PLUGIN_NOT_FOUND', '"' + id + '" requires unregistered "' + current + '"')
      seen.add(current)
      for (const dep of record.feature.depends ?? []) visit(dep, [...trail, current])
      closure.push(current)
    }
    visit(id, [])
    return closure
  }

  /** Hard dependents of a feature, deepest first, ending with the feature. */
  private dependentsOf(id: string, seen = new Set<string>()): string[] {
    if (seen.has(id)) return []
    seen.add(id)
    const out: string[] = []
    for (const [candidateId, record] of this.records) {
      if (record.feature.depends?.includes(id)) out.push(...this.dependentsOf(candidateId, seen))
    }
    out.push(id)
    return out
  }

  private async runSetup(id: string): Promise<void> {
    if(!this.enabled.has(id)||this.fibers.has(id))return
    const record=this.records.get(id)
    if(!record)return
    for(const dependency of this.requiredClosure(id))if(dependency!==id)await this.runSetup(dependency)
    if(!this.available(id,new Set()))return
    const controller=new AbortController()
    this.controllers.set(id,controller)
    this.loading.add(id);this.publish()
    try{
      const fiber=this.context.plugin({
        name:id,
        inject:(record.feature.depends??[]).map(dep=>'web-feature:'+dep),
        apply:async(ctx:Context)=>{
          this.scopeContexts.set(id,ctx)
          ctx.effect(()=>()=>{
            controller.abort()
            this.controllers.delete(id)
            this.scopeContexts.delete(id)
          })
          await record.feature.setup?.(this.createEnvironment(id,controller.signal))
          ctx.reflect.provide('web-feature:'+id,{id})
        },
      })
      this.fibers.set(id,fiber)
      await fiber
      this.failures.delete(id)
    }catch(error){
      await this.stop(id)
      this.enabled.delete(id);this.persistedDisabled.add(id)
      this.failures.set(id,error instanceof Error?error.message:String(error))
      this.logger.warn('[web-feature] setup failed, rolled back:',id,error)
      this.persist()
    }finally{this.loading.delete(id);this.publish()}
  }

  /** Tie a React effect's release to both its component and native Cordis scope. */
  ownEffect(id:string,dispose:()=>void|Promise<void>):()=>void {
    let done=false
    const release=()=>{if(done)return;done=true;return dispose()}
    const context=this.scopeContexts.get(id)
    const native=context?.effect(()=>release)
    if(!context){const list=this.disposers.get(id)??[];list.push(release);this.disposers.set(id,list)}
    return()=>{const result=native?native():release();void Promise.resolve(result).catch(error=>this.logger.warn('UI effect cleanup failed',error))}
  }

  private async stop(id:string):Promise<void>{
    this.controllers.get(id)?.abort()
    const fiber=this.fibers.get(id)
    this.fibers.delete(id)
    if(fiber)await fiber.dispose()
    this.scopeContexts.delete(id)
    this.controllers.delete(id)
    const disposers=this.disposers.get(id)??[]
    this.disposers.delete(id)
    for(const dispose of [...disposers].reverse())try{await dispose()}catch(error){this.logger.warn('[web-feature] dispose failed:',id,error)}
  }

  private available(id:string,trail:Set<string>):boolean {
    if(trail.has(id)||!this.enabled.has(id)||this.failures.has(id)||this.loading.has(id))return false
    const record=this.records.get(id)
    if(!record)return false
    trail.add(id)
    const result=(record.feature.depends??[]).every(dep=>this.available(dep,new Set(trail)))
    return result
  }

  private createEnvironment(id: string, signal: AbortSignal): WebFeatureEnvironment {
    const record = this.records.get(id)
    const permitted = new Set([
      ...(record?.feature.depends ?? []),
      ...(record?.feature.optionalDepends ?? []),
    ])
    return {
      id,
      signal,
      use: <T,>(depId: string, input?: unknown): T => {
        if (!permitted.has(depId)) {
          throw new WebFeatureError('UNDECLARED_DEPENDENCY', id + ' 没有声明依赖 ' + depId)
        }
        return this.call<T>(depId, input)
      },
      state: <T,>(key: string, init: () => T, cleanup?: (value: T) => void | Promise<void>) =>
        this.state<T>(key, init, cleanup),
      onDispose: (dispose: () => void | Promise<void>) => {
        this.ownEffect(id,dispose)
      },
      refresh: () => this.publish(),
    }
  }

  private statusOf(record: RegisterRecord): WebFeatureStatus {
    const id = record.feature.id
    if (this.failures.has(id)) return 'failed'
    if (!this.enabled.has(id)) return 'disabled'
    if ((record.feature.depends ?? []).some((dep) => !this.available(dep,new Set([id])))) {
      return 'blocked'
    }
    if (this.loading.has(id)) return 'loading'
    return 'enabled'
  }

  private publish(): void {
    const entries: WebFeatureEntry[] = []
    for (const record of this.records.values()) {
      const { feature } = record
      entries.push(
        Object.freeze({
          id: feature.id,
          capability: feature.capability,
          title: feature.title,
          description: feature.description,
          kind: feature.kind,
          slot: feature.slot,
          route: feature.route,
          order: record.order,
          source: record.source,
          status: this.statusOf(record),
          error: this.failures.get(feature.id),
          depends: Object.freeze([...(feature.depends ?? [])]),
          optionalDepends: Object.freeze([...(feature.optionalDepends ?? [])]),
          feature,
        }),
      )
    }
    entries.sort(compareEntries)

    const byId: Record<string, WebFeatureEntry> = {}
    const slots: Record<string, WebFeatureEntry[]> = {}
    const views: WebFeatureEntry[] = []
    const routes: WebFeatureEntry[] = []
    const main: WebNavEntry[] = []
    const aux: WebNavEntry[] = []

    for (const entry of entries) {
      byId[entry.id] = entry
      if (entry.kind === 'view' && entry.route) views.push(entry)
      if (entry.status !== 'enabled') continue
      if (entry.slot && entry.feature.render) (slots[entry.slot] ??= []).push(entry)
      if (entry.kind !== 'view' || !entry.route) continue
      routes.push(entry)
      if (entry.route.hidden || !entry.route.group) continue
      const nav: WebNavEntry = Object.freeze({
        id: entry.id,
        path: entry.route.path,
        titleKey: entry.route.titleKey ?? 'nav.archive',
        caption: entry.route.caption,
        icon: entry.route.icon ?? 'archive',
        order: entry.route.order ?? entry.order,
      })
      ;(entry.route.group === 'aux' ? aux : main).push(nav)
    }

    const byRoute = (a: WebFeatureEntry, b: WebFeatureEntry) =>
      (a.route?.order ?? a.order) - (b.route?.order ?? b.order) || a.id.localeCompare(b.id)
    views.sort(byRoute)
    routes.sort(byRoute)
    main.sort(compareEntries)
    aux.sort(compareEntries)

    for (const key of Object.keys(slots)) slots[key].sort(compareEntries)
    for (const [key, value] of Object.entries(slots)) slots[key] = Object.freeze(value) as WebFeatureEntry[]

    this.revision += 1
    this.snapshotValue = Object.freeze({
      revision: this.revision,
      features: Object.freeze(entries) as readonly WebFeatureEntry[],
      byId: Object.freeze(byId),
      slots: Object.freeze(slots),
      views: Object.freeze(views) as readonly WebFeatureEntry[],
      routes: Object.freeze(routes) as readonly WebFeatureEntry[],
      nav: Object.freeze({ main: Object.freeze(main), aux: Object.freeze(aux) }),
    }) as WebFeatureSnapshot

    for (const listener of [...this.listeners]) {
      try {
        listener(this.snapshotValue)
      } catch {
        /* one subscriber cannot break lifecycle */
      }
    }
  }

  private readPersistedDisabled(): Set<string> {
    if (!this.storage) return new Set()
    try {
      const raw = this.storage.getItem(this.storageKey)
      if (!raw) return new Set()
      const parsed = JSON.parse(raw) as { disabled?: unknown } | string[]
      const list = Array.isArray(parsed) ? parsed : Array.isArray(parsed?.disabled) ? parsed.disabled : []
      return new Set(list.filter((item): item is string => typeof item === 'string'))
    } catch {
      return new Set()
    }
  }

  private persist(): void {
    if (!this.storage) return
    try {
      const disabled = [...this.records.keys()].filter((id) => !this.enabled.has(id))
      this.storage.setItem(this.storageKey, JSON.stringify({ disabled }))
    } catch {
      /* private mode: keep the in-memory state */
    }
  }
}

export function createFeatureRegistry(options: FeatureRegistryOptions = {}): WebFeatureRegistry {
  return new WebFeatureRegistry(options)
}

/** The application-wide registry. Populated by plugins/catalog.ts. */
export const webPlugins = createFeatureRegistry()

/* ------------------------------------------------------------------ */
/* route matching                                                      */
/* ------------------------------------------------------------------ */

function segmentsOf(value: string): string[] {
  return value.split('/').filter(Boolean)
}

function matchScore(pattern: string, pathname: string): number {
  if (pattern === pathname) return 1000 + segmentsOf(pattern).length
  const patternSegments = segmentsOf(pattern)
  const targetSegments = segmentsOf(pathname)
  if (patternSegments.length !== targetSegments.length) return 0
  let score = 10
  for (let index = 0; index < patternSegments.length; index += 1) {
    const segment = patternSegments[index]
    if (segment.startsWith(':')) {
      score += 1
      continue
    }
    if (segment !== targetSegments[index]) return 0
    score += 10
  }
  return score
}

/** Best matching route entry for a pathname (literal segments beat params). */
export function matchRouteEntry(
  routes: readonly WebFeatureEntry[],
  pathname: string,
): WebFeatureEntry | null {
  let best: WebFeatureEntry | null = null
  let bestScore = 0
  for (const entry of routes) {
    const path = entry.route?.path
    if (!path) continue
    const score = matchScore(path, pathname)
    if (score > bestScore) {
      best = entry
      bestScore = score
    }
  }
  return best
}
