import type { Context } from '@deepseek-ai/cordis'
import type { FeatureEnvironment, FeaturePlugin } from '@rhine/plugin-api'
import type { AccountApi } from '../contracts.ts'
import type { Account, DeviceCodeFlow } from '../types.ts'
import type { MicrosoftBeginInput } from '../accounts/config.ts'
import { accountFeatures } from '../accounts/catalog.ts'
import { AccountError } from '../accounts/errors.ts'

export { AccountError } from '../accounts/errors.ts'
export { ACCOUNT_FILE, OFFLINE_NAME_PATTERN } from '../accounts/repository.ts'
export { ACCOUNT_HTTP_TIMEOUT_MS, ACCOUNT_HTTP_ATTEMPTS } from '../accounts/http.ts'

/**
 * Test-only compatibility adapter for the old AccountService method names.
 * It is NOT a Cordis Service, never provides ctx.accounts, and has no registration factory.
 * Production uses the independently discovered descriptors directly.
 */
export class AccountService implements AccountApi {
  private readonly controller = new AbortController()
  private readonly states = new Map<string, { value: unknown; cleanup?: (value: any) => void | Promise<void> }>()
  private readonly cleanups: Array<() => void | Promise<void>> = []
  private readonly descriptors = new Map<string, FeaturePlugin>(accountFeatures.map(feature => [feature.id, feature]))

  constructor(readonly ctx: Context, private readonly configuration: MicrosoftBeginInput = {}) {}

  list(): Account[] { return this.call('account.list') }
  get(id: string): Account | undefined { return this.call('account.get', { id }) }
  addOffline(name: string): Promise<Account> { return this.call('auth.offline.login', { name }) }
  addAuthlibInjector(authServerUrl: string, username: string, password: string): Promise<Account> { return this.call('auth.yggdrasil.login', { authServerUrl, username, password }) }
  remove(id: string): Promise<void> { return this.call('account.remove', { id }) }
  beginMicrosoft(input: MicrosoftBeginInput = this.configuration): Promise<DeviceCodeFlow> { return this.call('auth.microsoft.begin', input) }
  completeMicrosoft(input?: { flowId?: string }): Promise<Account> { return this.call('auth.microsoft.complete', input) }
  refresh(id: string): Promise<Account> { return this.call('account.refresh', { id }) }
  authorize(id: string): Promise<Account> { return this.call('account.authorize', { id }) }

  async dispose(): Promise<void> {
    this.controller.abort()
    for (const cleanup of this.cleanups) await cleanup()
    for (const state of this.states.values()) await state.cleanup?.(state.value)
    this.states.clear()
  }
  private call<T>(id: string, input?: unknown): T {
    if (this.controller.signal.aborted) throw new AccountError('账号测试适配器已关闭', 'REQUEST_CANCELLED')
    const descriptor = this.descriptors.get(id)
    if (!descriptor) throw new AccountError('未知账号动作：' + id, 'UNKNOWN_CAPABILITY')
    const allowed = new Set([...(descriptor.depends ?? []), ...(descriptor.optionalDepends ?? [])])
    const env: FeatureEnvironment = {
      context: this.ctx, signal: this.controller.signal,
      use: <O>(dependency: string, value?: unknown): O => {
        if (!allowed.has(dependency)) throw new AccountError('未声明的依赖：' + dependency, 'UNDECLARED_DEPENDENCY')
        if (this.descriptors.has(dependency)) return this.call<O>(dependency, value)
        if (dependency === 'paths.get') return this.ctx.paths.get() as O
        if (dependency === 'settings.get') return (this.ctx.settings?.get?.() ?? {}) as O
        if (dependency === 'storage.read.sync' || dependency === 'storage.read') {
          const options = value as { file: string; fallback: unknown }
          return (dependency === 'storage.read.sync' ? this.ctx.storage.readSync(options.file, options.fallback) : this.ctx.storage.read(options.file, options.fallback)) as O
        }
        if (dependency === 'storage.write') {
          const options = value as { file: string; value: unknown }
          return this.ctx.storage.write(options.file, options.value) as O
        }
        if (dependency === 'download.text') return this.ctx.download.text(value as string) as O
        if (dependency === 'download.buffer') return this.ctx.download.buffer(value as string) as O
        throw new AccountError('测试夹具缺少依赖：' + dependency, 'UNKNOWN_CAPABILITY')
      },
      state: <O>(key: string, init: () => O, cleanup?: (value: O) => void | Promise<void>): O => {
        const stored = this.states.get(key)
        if (stored) return stored.value as O
        const value = init()
        this.states.set(key, { value, cleanup })
        return value
      },
      onDispose: cleanup => { this.cleanups.push(cleanup) },
    }
    return descriptor.execute(input, env) as T
  }
}
