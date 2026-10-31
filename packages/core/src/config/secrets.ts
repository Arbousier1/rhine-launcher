/**
 * Server-side credential resolution.
 *
 * Two rules this module exists to enforce:
 *
 * 1. **Environment wins.** A deployment can inject credentials with env vars
 *    (`RHINE_MICROSOFT_CLIENT_ID`, `RHINE_CURSEFORGE_API_KEY`) without writing
 *    them into `launcher.json`, so a config directory can be copied or synced
 *    without carrying secrets along.
 * 2. **Secrets never leave the server.** Nothing here is ever serialized into an
 *    HTTP response or a frontend bundle; callers only ever learn *whether* a
 *    secret is configured. See `packages/core/src/plugins/public-value.ts`.
 *
 * This module must stay dependency-free and importable from both the service
 * layer and tests.
 */

/** Read a trimmed, non-empty environment value. */
export function envValue(name: string): string | undefined {
  const raw = process.env[name]
  if (typeof raw !== 'string') return undefined
  const value = raw.trim()
  return value ? value : undefined
}

/**
 * Where an effective credential came from.
 *
 * Exposed so the UI and diagnostics can explain *why* a field is locked:
 * an environment-provided secret cannot be edited from the settings page.
 */
export type SecretOrigin = 'env' | 'settings' | 'none'

export interface ResolvedSecret {
  value: string | undefined
  origin: SecretOrigin
}

/**
 * Resolve a credential: environment first, then the persisted setting.
 *
 * An empty environment variable is treated as "not set" so that a blank
 * `.env` template cannot silently erase a configured key.
 */
export function resolveSecret(envName: string, settingsValue?: string | null): ResolvedSecret {
  const fromEnv = envValue(envName)
  if (fromEnv) return { value: fromEnv, origin: 'env' }
  const fromSettings = typeof settingsValue === 'string' ? settingsValue.trim() : ''
  if (fromSettings) return { value: fromSettings, origin: 'settings' }
  return { value: undefined, origin: 'none' }
}

/** Environment variable names, in one place so docs and code cannot drift. */
export const SECRET_ENV = {
  microsoftClientId: 'RHINE_MICROSOFT_CLIENT_ID',
  microsoftAuthority: 'RHINE_MICROSOFT_AUTHORITY',
  curseforgeApiKey: 'RHINE_CURSEFORGE_API_KEY',
} as const

/** Effective CurseForge API key (env overrides settings). */
export function resolveCurseforgeApiKey(settingsValue?: string | null): ResolvedSecret {
  return resolveSecret(SECRET_ENV.curseforgeApiKey, settingsValue)
}

/** Effective Microsoft application (client) ID. */
export function resolveMicrosoftClientId(settingsValue?: string | null): ResolvedSecret {
  return resolveSecret(SECRET_ENV.microsoftClientId, settingsValue)
}
