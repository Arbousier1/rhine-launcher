import type { Context } from '@deepseek-ai/cordis'
import type { FeatureEnvironment } from '@rhine/plugin-api'

/**
 * Shared implementation data is not a plugin. The runtime rebinds a class
 * receiver's context per invocation, so it cannot capture the first feature's
 * lifetime. Only the single action descriptor exposes it to callers.
 */
export function implementation<T>(env: FeatureEnvironment, key: string, create: (ctx: Context) => T, cleanup?: (value:T)=>void|Promise<void>): T {
  return env.state(key,()=>create(env.context),cleanup)
}
