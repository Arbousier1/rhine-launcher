/**
 * The OAuth application identity this build ships with.
 *
 * How HMCL does it (verified in `.reference/HMCL`):
 *
 * - `HMCL/build.gradle.kts` reads `MICROSOFT_AUTH_ID` from the release
 *   environment and writes it into the jar manifest as
 *   `hmcl.microsoft.auth.id`.
 * - `OAuthServer.Factory#getClientId()` returns
 *   `System.getProperty("hmcl.microsoft.auth.id", JarUtils.getAttribute(..., ""))`,
 *   so a developer can point a build at their own registration with a single
 *   `-D` flag, and an unconfigured build reports "not supported" instead of
 *   silently borrowing somebody else's app.
 *
 * Rhine follows the same shape, in the order that keeps the release usable
 * without hard-coding a "secret-looking" constant:
 *
 * 1. an explicit request value (the caller knows what it wants),
 * 2. `RHINE_MICROSOFT_CLIENT_ID` (deployments and CI),
 * 3. the saved setting (the desktop UI),
 * 4. this built-in identity, published by the project owner.
 *
 * The application (client) ID is **not** a secret. It appears in every
 * authorize URL and is copied by anyone watching the traffic, which is exactly
 * why Microsoft requires the *public client* flow and no client secret. What
 * must never ship is a client secret — and this launcher never has one.
 *
 * `RHINE_MICROSOFT_CLIENT_ID=off` disables the built-in identity, so a
 * downstream distributor can ship Rhine without inheriting this registration.
 */

/**
 * Registry entry owned by this project.
 *
 * Registered as a public/native client (`isFallbackPublicClient: true`).
 * Device-code issuance has been observed, but that is NOT evidence of Mojang's
 * separate Minecraft Java API allowlist approval or game ownership. No such
 * approval evidence is currently recorded for this application in the repo.
 * Consumer Microsoft accounts are required for XboxLive.signin. See
 * `docs/MICROSOFT-OAUTH-APP-ID.md` for the separate publisher review step.
 */
export const BUILTIN_MICROSOFT_APP = {
  /** Application (client) ID, public by design. */
  clientId: 'c0161cf4-3180-4a1a-919b-19f75d039d32',
  /** Consumer tenant endpoint used for Xbox Live sign-in. */
  authority: 'https://login.microsoftonline.com/consumers/oauth2/v2.0',
  /** Human-readable owner, surfaced in diagnostics. */
  publisher: 'Rhine Launcher',
} as const

/**
 * Opt-out value for {@link SECRET_ENV.microsoftClientId}.
 *
 * Mirrors HMCL's "unofficial build" path: without an app id the login pane
 * explains the situation instead of pretending a login is possible.
 */
export const BUILTIN_APP_OPT_OUT = 'off'

/**
 * The built-in app id, or undefined when a distributor opted out.
 *
 * Read through a function so tests and downstream builds can flip it without
 * module-level caching.
 */
export function builtinMicrosoftClientId(envName: string): string | undefined {
  const raw = process.env[envName]
  if (typeof raw === 'string' && raw.trim().toLowerCase() === BUILTIN_APP_OPT_OUT) return undefined
  return BUILTIN_MICROSOFT_APP.clientId
}
