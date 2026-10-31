import type { Context } from '@deepseek-ai/cordis'

export type FeatureId = string
export type FeatureStatus = 'disabled' | 'loading' | 'enabled' | 'blocked' | 'failed'
export interface TaskContext {
  readonly id: string
  readonly cancelled: boolean
  throwIfCancelled(): void
  setProgress(progress: { value?: number; stage?: 'resolve'|'download'|'verify'|'extract'|'write'|'done'; current?: number; total?: number; message?: string }): void
  log(message: string, level?: 'debug'|'info'|'warn'|'error'): void
}
export interface FeatureEnvironment {
  /** Cordis lifecycle context with compatibility projections, NOT bundled feature services. */
  readonly context: Context
  readonly config?: unknown
  readonly signal: AbortSignal
  readonly task?: TaskContext
  /** Invoke another declared capability. No direct implementation imports across feature domains. */
  use<T = unknown>(id: FeatureId, input?: unknown): T
  /** Shared non-plugin data/repository state. It exposes no capability on its own. */
  state<T>(key: string, init: () => T, cleanup?: (value: T) => void | Promise<void>): T
  onDispose(dispose: () => void | Promise<void>): void
}
export interface FeatureHttp<I = unknown, O = unknown> {
  method: 'GET'|'POST'|'PATCH'|'PUT'|'DELETE'
  path: string
  decode?(request: Request, params: Record<string,string>): I | Promise<I>
  encode?(output: Awaited<O>, input: I): unknown
  status?: number
  notFoundMessage?: string
  /** Same single action, run as a cancellable background task. */
  background?: { kind: string; title: string | ((input:I)=>string) }
}
/** One manifest, one capability, one action. Collections are catalogs, never plugins. */
export interface FeaturePlugin<I = any, O = any> {
  readonly id: FeatureId
  readonly capability: FeatureId
  readonly title: string
  readonly description?: string
  readonly depends?: readonly FeatureId[]
  readonly optionalDepends?: readonly FeatureId[]
  readonly http?: FeatureHttp<I,O>
  readonly tags?: readonly string[]
  readonly Config?: { readonly '~standard': {validate(value:unknown): {value?:unknown;issues?:readonly {message:string}[]} | Promise<{value?:unknown;issues?:readonly {message:string}[]}>} }
  execute(input: I, env: FeatureEnvironment): O
  setup?(env: FeatureEnvironment): void | Promise<void>
}
export interface FeatureSnapshot {
  id: string
  capability: string
  title: string
  description?: string
  depends: string[]
  status: FeatureStatus
  activeCalls: number
  error?: string
}
export interface FeatureCallOptions { task?: TaskContext; signal?: AbortSignal }
export interface FeatureConfigurationEntry {id:string;disabled?:boolean;config?:unknown}
export interface StartFeaturesOptions { disabled?: readonly FeatureId[]; entries?: readonly FeatureConfigurationEntry[] }
export interface FeatureCatalogEntry { plugin: FeaturePlugin; source?: string }
