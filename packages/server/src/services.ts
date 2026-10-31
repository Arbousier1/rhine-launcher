/**
 * Typed access to the Cordis services mounted on the launcher context.
 *
 * The server never holds references to concrete core classes: it resolves the
 * interfaces from `ctx` on every request, so a partially assembled context
 * (or a test double) behaves exactly like the real one.
 */
import type { RhContext } from '@rhine/core'
import type {
  AccountApi, BusApi, DownloadApi, InstanceApi, JavaApi, LaunchApi, LoaderApi,
  MarketApi, MetaApi, ModApi, PathsApi, SettingsApi, StorageApi, TaskApi,
} from '@rhine/core'
import { ApiError } from './http.ts'

/** Every service the HTTP/WS shell knows how to talk to. */
export interface ServiceMap {
  paths: PathsApi
  storage: StorageApi
  settings: SettingsApi
  bus: BusApi
  tasks: TaskApi
  download: DownloadApi
  meta: MetaApi
  loader: LoaderApi
  java: JavaApi
  accounts: AccountApi
  instances: InstanceApi
  mods: ModApi
  market: MarketApi
  launch: LaunchApi
}

/** A service name. */
export type ServiceName = keyof ServiceMap

/** Read a service off the context without trusting the compile time shape. */
function read(ctx: RhContext, name: string): unknown {
  return (ctx as unknown as Record<string, unknown>)[name]
}

/**
 * Resolve a required service.
 *
 * @throws ApiError 503 with a Chinese message when the service is not loaded
 *   yet (the launcher is still assembling its plugins).
 */
export function service<K extends ServiceName>(ctx: RhContext, name: K): ServiceMap[K] {
  const api = read(ctx, name)
  if (!api) throw ApiError.unavailable(`服务 ${name} 尚未就绪，请稍后重试`)
  return api as ServiceMap[K]
}

/** Resolve a service, returning `undefined` when it is not mounted. */
export function optionalService<K extends ServiceName>(ctx: RhContext, name: K): ServiceMap[K] | undefined {
  return read(ctx, name) as ServiceMap[K] | undefined
}

/**
 * Diagnostics is an optional capability: core installs it only when the
 * corresponding plugin is present, so every call site must tolerate a miss.
 */
export function diagnosticsOf(ctx: RhContext): NonNullable<RhContext['diagnostics']> | undefined {
  const api = read(ctx, 'diagnostics') as RhContext['diagnostics']
  return api && typeof api.analyze === 'function' ? api : undefined
}
