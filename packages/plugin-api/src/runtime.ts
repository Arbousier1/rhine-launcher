import { Context } from '@deepseek-ai/cordis'
import type { FeatureCallOptions, FeatureCatalogEntry, FeatureConfigurationEntry, FeatureEnvironment, FeaturePlugin, FeatureSnapshot, FeatureStatus, StartFeaturesOptions } from './types.ts'

/** A structured failure that transports can expose without leaking internals. */
export class FeatureError extends Error {
  readonly status: number
  constructor(readonly code: string, message: string, status = 503) {
    super(message)
    this.name = 'FeatureError'
    this.status = status
  }
}

/** Enforce the public contract: a plugin cannot expose a collection of capabilities. */
export function defineFeature<I, O>(plugin: FeaturePlugin<I,O>): FeaturePlugin<I,O> {
  if (!plugin || typeof plugin !== 'object') throw new FeatureError('INVALID_PLUGIN', '插件描述必须是对象', 400)
  if (typeof plugin.id !== 'string' || !/^[a-z][a-z0-9]*(?:[.-][a-z0-9]+)*$/.test(plugin.id)) {
    throw new FeatureError('INVALID_PLUGIN', '插件必须有明确的单功能标识', 400)
  }
  if (plugin.capability !== plugin.id || typeof plugin.execute !== 'function') {
    throw new FeatureError('MULTIPLE_CAPABILITIES', '每个插件只能提供一个与 id 同名的功能和一个 execute 入口', 400)
  }
  const object = plugin as unknown as Record<string,unknown>
  for (const key of ['capabilities', 'features', 'routes', 'plugins']) {
    if (key in object) throw new FeatureError('MULTIPLE_CAPABILITIES', '插件不能批量注册功能：' + key, 400)
  }
  for (const id of [...(plugin.depends ?? []), ...(plugin.optionalDepends ?? [])]) {
    if (typeof id !== 'string' || !id || id === plugin.id) throw new FeatureError('INVALID_DEPENDENCY', '插件依赖必须指向另一个功能：' + plugin.id, 400)
  }
  if (plugin.http && (Array.isArray(plugin.http) || typeof plugin.http.path !== 'string' || !plugin.http.path.startsWith('/api/'))) {
    throw new FeatureError('MULTIPLE_CAPABILITIES', '一个插件只能描述同一功能的一个 HTTP 接口', 400)
  }
  return Object.freeze({ ...plugin, depends: Object.freeze([...new Set(plugin.depends ?? [])]), optionalDepends: Object.freeze([...new Set(plugin.optionalDepends ?? [])]) })
}

interface RecordEntry {
  definition: FeaturePlugin
  source?: string
  status: FeatureStatus
  desired: boolean
  error?: string
  activeCalls: number
  controller?: AbortController
  fiber?: { dispose(): Promise<void> }
  environment?: FeatureEnvironment
  leases: Set<Promise<unknown>>
}
interface StateEntry { value: unknown; cleanup?: (value: unknown) => void | Promise<void> }
export interface ProjectionAction {
  feature: string | ((args: unknown[]) => string)
  input?(args: unknown[]): unknown
  output?(result: unknown): unknown
}


/**
 * The host has no Minecraft functionality. It only owns the Cordis dependency
 * graph, feature lookup and lifecycle. Every registered fiber provides exactly
 * one capability; compatibility projections must go back through call().
 */
export class FeatureRuntime {
  private records = new Map<string,RecordEntry>()
  private states = new Map<string,StateEntry>()
  private projections = new Map<string,Record<string,ProjectionAction>>()
  private explicitDisabled = new Set<string>()
  private listeners = new Set<(snapshot: readonly FeatureSnapshot[]) => void>()
  private snapshotValue: readonly FeatureSnapshot[] = Object.freeze([])
  private queue: Promise<unknown> = Promise.resolve()
  private disposed = false
  private started = false
  private configs = new Map<string,unknown>()

  constructor(readonly context: Context = new Context()) {
    const present = context.reflect.get('features')
    if (present && present !== this) throw new FeatureError('DUPLICATE_RUNTIME', '此上下文已经有插件宿主', 400)
    context.reflect.provide('features', this)
  }

  register<I,O>(definition: FeaturePlugin<I,O>, source?: string): void {
    this.assertAlive()
    const plugin = defineFeature(definition)
    if (this.records.has(plugin.id)) throw new FeatureError('DUPLICATE_CAPABILITY', '功能已注册：' + plugin.id, 409)
    this.records.set(plugin.id, { definition: plugin, source, status: 'disabled', desired: !this.explicitDisabled.has(plugin.id), activeCalls: 0, leases: new Set() })
    this.publish()
    if(this.started)void this.serial(async()=>{
      if(this.disposed)return
      await this.enableInternal(plugin.id,[])
      for(const record of this.records.values())if(record.desired&&record.status==='blocked')await this.enableInternal(record.definition.id,[])
      this.publish()
    }).catch(()=>{})
  }

  registerAll(plugins: readonly FeaturePlugin[]): void { for (const plugin of plugins) this.register(plugin) }
  /** Await module arrival before activating its declared dependency graph. */
  async load(entries:Promise<readonly FeatureCatalogEntry[]>|readonly FeatureCatalogEntry[]):Promise<void>{
    return this.serial(async()=>{
      this.assertAlive()
      for(const entry of await entries)this.register(entry.plugin,entry.source)
      this.started=true
      for(const record of this.records.values())if(record.desired)await this.enableInternal(record.definition.id,[])
      this.publish()
    })
  }
  definitions(): FeaturePlugin[] { return [...this.records.values()].map(record => record.definition) }
  async settled(): Promise<void> { await this.queue }
  definition(id: string): FeaturePlugin | undefined { return this.records.get(id)?.definition }
  getDefinition(id: string): FeaturePlugin | undefined { return this.definition(id) }
  get(id: string): FeatureSnapshot | undefined { const record = this.records.get(id); return record && this.toSnapshot(record) }
  has(id: string): boolean { return this.records.get(id)?.status === 'enabled' && !!this.context.reflect.get('feature:' + id) }
  list(): FeatureSnapshot[] { return [...this.records.values()].map(record => this.toSnapshot(record)) }
  snapshot = (): readonly FeatureSnapshot[] => this.snapshotValue
  getSnapshot = (): readonly FeatureSnapshot[] => this.snapshotValue
  getState = (): readonly FeatureSnapshot[] => this.snapshotValue
  subscribe = (listener: (snapshot: readonly FeatureSnapshot[]) => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  configuration(): { disabled: string[]; entries: FeatureConfigurationEntry[] } { return { disabled: [...this.explicitDisabled],entries:[...this.configs.entries()].map(([id,config])=>({id,config})) } }

  async start(options: StartFeaturesOptions = {}): Promise<void> {
    return this.serial(async () => {
      this.assertAlive()
      this.started = true
      this.explicitDisabled = new Set(options.disabled ?? [])
      for(const entry of options.entries??[]){const record=this.requireRecord(entry.id);this.configs.set(entry.id,await this.validateConfig(record.definition,entry.config));if(entry.disabled===true)this.explicitDisabled.add(entry.id)}
      for (const record of this.records.values()) record.desired = !this.explicitDisabled.has(record.definition.id)
      const removed = new Set<string>()
      for (const id of this.explicitDisabled) {
        if (!this.records.has(id)) continue
        for (const affected of this.dependentsOf(id)) {
          if (removed.has(affected)) continue
          removed.add(affected)
          await this.unload(affected, this.explicitDisabled.has(affected) ? 'disabled' : 'blocked', affected === id ? undefined : '依赖已停用：' + id)
        }
      }
      for (const record of this.records.values()) {
        if (record.desired) await this.enableInternal(record.definition.id, [])
      }
      this.publish()
    })
  }

  async enable(id: string): Promise<void> {
    return this.serial(async () => {
      this.assertAlive()
      this.requireRecord(id)
      this.explicitDisabled.delete(id)
      this.requireRecord(id).desired = true
      await this.enableInternal(id, [])
      // Previously blocked dependents return automatically, but intentionally
      // disabled peers stay disabled.
      for (const record of this.records.values()) {
        if (record.desired && record.status === 'blocked') await this.enableInternal(record.definition.id, [])
      }
      this.publish()
      const record = this.requireRecord(id)
      if (record.status !== 'enabled') throw new FeatureError('PLUGIN_BLOCKED', record.error ?? ('插件未能启用：' + id))
    })
  }

  async disable(id: string): Promise<void> {
    return this.serial(async () => {
      this.assertAlive()
      this.requireRecord(id)
      const plan = this.dependentsOf(id)
      this.explicitDisabled.add(id)
      this.requireRecord(id).desired = false
      for (const affected of plan) await this.unload(affected, affected === id ? 'disabled' : 'blocked', affected === id ? undefined : '依赖已停用：' + id)
      this.publish()
    })
  }

  /** Preserve synchronous return values (list/get/cache calls), and track async leases. */
  call<T = unknown>(id: string, input?: unknown, options: FeatureCallOptions = {}): T {
    this.assertAlive()
    const record = this.requireRecord(id)
    if (!this.has(id) || !record.controller || !record.environment) {
      throw new FeatureError('PLUGIN_UNAVAILABLE', record.error ?? ('功能插件未启用：' + id))
    }
    const signal = options.signal
      ? AbortSignal.any([record.controller.signal, options.signal])
      : record.controller.signal
    if (signal.aborted) throw new FeatureError('PLUGIN_CANCELLED', '功能执行已取消：' + id, 409)
    const env = this.makeEnvironment(record, record.environment.context, signal, options)
    record.activeCalls++
    try {
      const result = record.definition.execute(input, env)
      if (result && typeof result.then === 'function') {
        const lease = this.abortable(Promise.resolve(result), signal, id)
          .finally(() => { record.activeCalls--; record.leases.delete(lease) })
        record.leases.add(lease)
        // The consumer still receives rejection; the host observes it as well
        // so a detached operation cannot cause an unhandled rejection on unload.
        void lease.catch(() => {})
        return lease as T
      }
      record.activeCalls--
      return result as T
    } catch (error) {
      record.activeCalls--
      throw error
    }
  }
  invoke<T = unknown>(id: string, input?: unknown, options?: FeatureCallOptions): T { return this.call<T>(id,input,options) }

  /** Reconcile selected entries by stable id; only materially changed fibers reload. */
  async reconcile(entries:readonly FeatureConfigurationEntry[]):Promise<void>{
    return this.serial(async()=>{
      this.assertAlive()
      const nextConfigs=new Map(this.configs),nextDisabled=new Set(this.explicitDisabled),seen=new Set<string>(),affected=new Set<string>()
      for(const entry of entries){
        if(seen.has(entry.id))throw new FeatureError('DUPLICATE_CONFIG','配置 id 重复：'+entry.id,400)
        seen.add(entry.id)
        const record=this.requireRecord(entry.id)
        if('config' in entry){
          const config=await this.validateConfig(record.definition,entry.config)
          if(stableConfig(config)!==stableConfig(this.configs.get(entry.id))){nextConfigs.set(entry.id,config);for(const id of this.dependentsOf(entry.id))affected.add(id)}
        }
        if(entry.disabled!==undefined&&entry.disabled!==this.explicitDisabled.has(entry.id)){
          if(entry.disabled)nextDisabled.add(entry.id);else nextDisabled.delete(entry.id)
          for(const id of this.dependentsOf(entry.id))affected.add(id)
        }
      }
      if(!affected.size)return
      const beforeConfigs=this.configs,beforeDisabled=new Set(this.explicitDisabled),beforeEnabled=new Set(this.list().filter(item=>item.status==='enabled').map(item=>item.id))
      try{
        for(const id of affected)await this.unload(id,'disabled')
        this.configs=nextConfigs;this.explicitDisabled=nextDisabled
        for(const record of this.records.values())record.desired=!nextDisabled.has(record.definition.id)
        for(const id of affected)if(!nextDisabled.has(id))await this.enableInternal(id,[])
        const failure=[...affected].map(id=>this.requireRecord(id)).find(record=>record.desired&&record.status==='failed')
        if(failure)throw new FeatureError('CONFIG_ACTIVATION_FAILED',failure.error??'配置激活失败',400)
      }catch(error){
        for(const id of affected)await this.unload(id,'disabled')
        this.configs=beforeConfigs;this.explicitDisabled=beforeDisabled
        for(const record of this.records.values())record.desired=!beforeDisabled.has(record.definition.id)
        for(const id of beforeEnabled)await this.enableInternal(id,[])
        this.publish();throw error
      }
      this.publish()
    })
  }

  /** Transactionally replace one implementation; failed activation restores the old graph. */
  async replace(id:string,definition:FeaturePlugin):Promise<void>{
    return this.serial(async()=>{
      this.assertAlive()
      const next=defineFeature(definition)
      if(next.id!==id)throw new FeatureError('IDENTITY_CHANGED','替换插件必须保留稳定 id',400)
      const record=this.requireRecord(id),previous=record.definition
      await this.validateConfig(next,this.configs.get(id))
      const affected=this.dependentsOf(id),beforeEnabled=new Set(this.list().filter(item=>item.status==='enabled').map(item=>item.id))
      for(const item of affected)await this.unload(item,'disabled')
      record.definition=next
      try{
        for(const item of [...affected].reverse())if(this.requireRecord(item).desired)await this.enableInternal(item,[])
        if(record.desired&&record.status!=='enabled')throw new FeatureError('REPLACEMENT_FAILED',record.error??'新插件未能激活',400)
      }catch(error){
        for(const item of this.records.keys())if(affected.includes(item)||!beforeEnabled.has(item)&&this.has(item))await this.unload(item,'disabled')
        record.definition=previous
        for(const item of beforeEnabled)await this.enableInternal(item,[])
        this.publish();throw error
      }
      this.publish()
    })
  }

  private async validateConfig(plugin:FeaturePlugin,config:unknown):Promise<unknown>{
    if(!plugin.Config)return config
    const result=await plugin.Config['~standard'].validate(config)
    if(result.issues?.length)throw new FeatureError('INVALID_CONFIG',plugin.id+' 配置无效：'+result.issues.map(issue=>issue.message).join('；'),400)
    return result.value
  }

  /** State is shared implementation data, not another public service/plugin. */
  state<T>(key: string, init: () => T, cleanup?: (value: T) => void | Promise<void>): T {
    this.assertAlive()
    const known = this.states.get(key)
    if (known) return known.value as T
    const value = init()
    this.states.set(key, { value, cleanup: cleanup as StateEntry['cleanup'] })
    return value
  }
  hasState(key: string): boolean { return this.states.has(key) }
  seedState<T>(key: string, value: T): void {
    if (this.states.has(key)) throw new FeatureError('DUPLICATE_STATE', '宿主状态已初始化：' + key, 409)
    this.states.set(key,{value})
  }

  async dispose(): Promise<void> {
    return this.serial(async () => {
      if (this.disposed) return
      // Reverse dependency order; dispose keeps cleanup deterministic even if
      // a capability registered a listener or renderer during its setup.
      const seen = new Set<string>()
      for (const id of this.records.keys()) {
        for (const affected of this.dependentsOf(id)) {
          if (seen.has(affected)) continue
          seen.add(affected)
          await this.unload(affected, 'disabled')
        }
      }
      for (const state of [...this.states.values()].reverse()) if (state.cleanup) await state.cleanup(state.value)
      this.states.clear()
      this.disposed = true
      this.publish()
      this.listeners.clear()
    })
  }

  private async enableInternal(id: string, trail: string[]): Promise<void> {
    const record = this.requireRecord(id)
    if (this.has(id)) return
    if (record.status === 'enabled') { record.status = 'disabled'; record.environment = undefined }
    if (this.explicitDisabled.has(id)) { record.status = 'disabled'; return }
    if (trail.includes(id)) {
      record.status = 'failed'
      record.error = '插件依赖存在循环：' + [...trail,id].join(' → ')
      throw new FeatureError('DEPENDENCY_CYCLE',record.error,400)
    }
    for (const dependency of record.definition.depends ?? []) {
      const parent = this.records.get(dependency)
      if (!parent) { record.status = 'blocked'; record.error = '缺少依赖插件：' + dependency; return }
      try { await this.enableInternal(dependency,[...trail,id]) }
      catch (error) { record.status = 'blocked'; record.error = error instanceof Error ? error.message : String(error); return }
      if (parent.status !== 'enabled') { record.status = 'blocked'; record.error = '依赖不可用：' + dependency; return }
    }
    record.status = 'loading'
    record.error = undefined
    record.controller = new AbortController()
    const controller = record.controller
    const apply = async (ctx: Context) => {
      const env = this.makeEnvironment(record,ctx,controller.signal,{})
      record.environment = env
      ctx.effect(() => () => {
        controller.abort()
        if (record.controller === controller) {
          record.environment = undefined
          if (record.status === 'enabled' || record.status === 'loading') {
            record.status = 'disabled'
            record.error = '插件作用域已卸载'
            this.publish()
          }
        }
      })
      await record.definition.setup?.(env)
      ctx.reflect.provide('feature:' + id, { invoke: (input?: unknown) => this.call(id,input) })
    }
    try {
      const fiber = this.context.plugin({ name: id, inject: (record.definition.depends ?? []).map(dep=>'feature:'+dep), apply })
      record.fiber = fiber
      await fiber
      record.status = 'enabled'
    } catch (error) {
      controller.abort()
      await record.fiber?.dispose().catch(()=>{})
      record.fiber = undefined
      record.status = 'failed'
      record.error = error instanceof Error ? error.message : String(error)
    }
  }

  private makeEnvironment(record: RecordEntry, ctx: Context, signal: AbortSignal, options: FeatureCallOptions): FeatureEnvironment {
    const permitted = new Set([...(record.definition.depends ?? []),...(record.definition.optionalDepends ?? [])])
    let reverting = false
    const use = <T>(id: string,input?: unknown): T => {
      if (!permitted.has(id)) throw new FeatureError('UNDECLARED_DEPENDENCY', record.definition.id + ' 没有声明依赖 ' + id, 500)
      // During this scope's registered inverse, required providers remain alive
      // until dependents finish teardown (paper section 5.1.4 / Theorem 70).
      return this.call<T>(id,input,reverting ? {} : {...options,signal})
    }
    const view = this.scopedContext(ctx, record.definition.id, use)
    return {
      context: view, config: this.configs.get(record.definition.id), signal, task: options.task, use,
      state: <T>(key: string,init:()=>T,cleanup?:(value:T)=>void|Promise<void>): T => {
        const value = this.state(key,init,cleanup)
        // A shared implementation must not retain the first plugin's scoped
        // context. Rebind its receiver per invocation while data remains shared.
        return this.bindState(value,view)
      },
      onDispose: (dispose) => { ctx.effect(()=>async()=>{reverting=true;try{await dispose()}finally{reverting=false}}) },
    }
  }

  /** Host-owned compatibility projection. It contains no implementation logic. */
  project(name: string, actions: Record<string,ProjectionAction>): void {
    if (this.projections.has(name)) throw new FeatureError('DUPLICATE_PROJECTION','重复上下文投影：'+name,409)
    this.projections.set(name,actions)
    const projection = this.makeProjection(actions,<T>(id: string,input?: unknown): T => this.call<T>(id,input))
    this.context.reflect.provide(name,projection)
  }

  private makeProjection(actions: Record<string,ProjectionAction>, use: <T>(id:string,input?:unknown)=>T): Record<string,(...args:unknown[])=>unknown> {
    return Object.fromEntries(Object.entries(actions).map(([method,action])=>[method,(...args:unknown[])=>{
      const id = typeof action.feature === 'function' ? action.feature(args) : action.feature
      const result = use(id, action.input ? action.input(args) : args[0])
      return action.output ? action.output(result) : result
    }]))
  }

  private scopedContext(ctx: Context, owner: string, use: <T>(id:string,input?:unknown)=>T): Context {
    let view: Context
    const features = Object.freeze({
      call: use, invoke: use,
      has: (id: string) => this.has(id),
      list: () => this.list(),
      get: (id: string) => this.get(id),
      configuration: () => this.configuration(),
      reconcile: (entries: readonly FeatureConfigurationEntry[]) => { if(owner!=='plugins.configure')throw new FeatureError('HOST_ONLY','只有配置协调功能可修改组件配置',403);return this.reconcile(entries) },
      enable: (id: string) => { if (owner !== 'plugins.enable') throw new FeatureError('HOST_ONLY','只有启用插件功能可修改宿主',403); return this.enable(id) },
      disable: (id: string) => { if (owner !== 'plugins.disable') throw new FeatureError('HOST_ONLY','只有停用插件功能可修改宿主',403); return this.disable(id) },
    })
    const cache = new Map<string,unknown>()
    view = new Proxy(ctx, {
      get: (_target,key) => {
        if (key === 'root') return view
        if (key === 'features') return features
        if (key === 'get') return (name: string) => Reflect.get(view,name)
        if (typeof key === 'symbol') return Reflect.get(ctx,key)
        const actions = this.projections.get(key)
        if (actions) {
          if (!cache.has(key)) cache.set(key,this.makeProjection(actions,use))
          return cache.get(key)
        }
        if (['logger','effect','on','once','off','emit','parallel','serial','waterfall'].includes(key)) return Reflect.get(ctx,key)
        if (key === 'baseUrl') return ctx.baseUrl
        if (key === 'fiber') return Object.freeze({ name: ctx.fiber.name, effect: ctx.effect })
        throw new FeatureError('UNDECLARED_SERVICE',owner + ' 不能直接访问宿主服务 '+key,403)
      },
      set: () => { throw new FeatureError('HOST_ONLY','功能插件不能注册额外宿主服务',403) },
    })
    return view
  }

  private bindState<T>(value: T, ctx: Context): T {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const prototype = Object.getPrototypeOf(value)
    if (!prototype || prototype === Object.prototype || value instanceof Map || value instanceof Set || value instanceof Date) return value
    return new Proxy(value as object, {
      get: (target,key,receiver) => {
        if ((key === 'ctx' || key === 'context') && Context.is(Reflect.get(target,key))) return ctx
        return Reflect.get(target,key,receiver)
      },
      set: (target,key,next) => Reflect.set(target,key,next,target),
    }) as T
  }

  private abortable<T>(promise: Promise<T>, signal: AbortSignal, id: string): Promise<T> {
    return new Promise<T>((resolve,reject) => {
      const abort = () => reject(new FeatureError('PLUGIN_CANCELLED','功能执行已取消：'+id,409))
      if (signal.aborted) { abort(); void promise.catch(()=>{}); return }
      signal.addEventListener('abort',abort,{once:true})
      promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort)).catch(()=>{})
    })
  }

  private async unload(id: string, status: FeatureStatus, error?: string): Promise<void> {
    const record = this.requireRecord(id)
    record.status = status
    record.error = error
    record.controller?.abort()
    await Promise.allSettled([...record.leases])
    await record.fiber?.dispose()
    record.fiber = undefined
    record.environment = undefined
    record.controller = undefined
    record.status = status
    record.error = error
  }
  private dependentsOf(id: string, seen = new Set<string>()): string[] {
    if (seen.has(id)) return []
    seen.add(id)
    const out: string[] = []
    for (const record of this.records.values()) {
      if (record.definition.depends?.includes(id)) out.push(...this.dependentsOf(record.definition.id,seen))
    }
    out.push(id)
    return out
  }
  private toSnapshot(record: RecordEntry): FeatureSnapshot {
    return { id: record.definition.id, capability: record.definition.capability, title: record.definition.title, description: record.definition.description, depends: [...(record.definition.depends ?? [])], status: record.status, activeCalls: record.activeCalls, error: record.error }
  }
  private publish(): void {
    this.snapshotValue = Object.freeze(this.list().map(item=>Object.freeze(item)))
    for (const listener of [...this.listeners]) { try { listener(this.snapshotValue) } catch { /* One UI subscriber cannot break lifecycle cleanup. */ } }
  }
  private requireRecord(id: string): RecordEntry {
    const record = this.records.get(id)
    if (!record) throw new FeatureError('PLUGIN_NOT_FOUND','找不到功能插件：'+id,404)
    return record
  }
  private assertAlive(): void { if (this.disposed) throw new FeatureError('HOST_DISPOSED','插件宿主已关闭',409) }
  private serial<T>(operation: ()=>Promise<T>): Promise<T> {
    const next = this.queue.then(operation,operation)
    this.queue = next.catch(()=>{})
    return next
  }
}

declare module '@deepseek-ai/cordis' { interface Context { features: FeatureRuntime } }
/** Value equality ignores object-key insertion order; fiber identity is kept separately. */
function stableConfig(value:unknown):string {
 if(value===undefined)return 'undefined'
 if(value===null||typeof value!=='object')return JSON.stringify(value)
 if(Array.isArray(value))return '['+value.map(stableConfig).join(',')+']'
 return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([key,item])=>JSON.stringify(key)+':'+stableConfig(item)).join(',')+'}'
}

