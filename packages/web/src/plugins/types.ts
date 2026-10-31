/**
 * Browser-side feature plugin contract.
 *
 * This mirrors @rhine/plugin-api (the Cordis side): one file, one capability,
 * one default descriptor, and the same runtime vocabulary — register / start /
 * enable / disable / call / state / snapshot / subscribe / dispose.
 *
 * A web feature contributes exactly one thing:
 * - `view`   a page: owns one route plus its nav metadata.
 * - `motion` one animated component rendered through a named slot.
 * - `slot`   one shell widget (a top-bar button, the toast host, …).
 * - `effect` headless: setup()/teardown() only (bootstrap, theme priming, …).
 *
 * Nothing here imports a page or a motion implementation; the catalog does
 * that. The host only renders slots and registry-derived routes.
 */
import type { ComponentType } from 'react'

export type WebFeatureId = string

export type WebFeatureKind = 'view' | 'motion' | 'slot' | 'effect'

/** Same lifecycle vocabulary as the Cordis runtime. */
export type WebFeatureStatus = 'disabled' | 'loading' | 'enabled' | 'blocked' | 'failed'

/** Route/nav metadata that travels with a view feature. */
export interface WebRouteMeta {
  /** react-router pattern, e.g. "/" or "/instances/:id". */
  path: string
  /** Sidebar group; omit or set `hidden` to keep it out of the rail. */
  group?: 'main' | 'aux'
  /** Ordering inside the group (and inside the route table). */
  order?: number
  /** i18n key for the sidebar/top-bar label. */
  titleKey?: string
  /** Latin eyebrow shown in the top bar. */
  caption: string
  /** Icon name resolved by the shell (unknown names fall back to a dot). */
  icon?: string
  hidden?: boolean
  /** Extra paths that redirect to this route. */
  aliases?: readonly string[]
}

/** Environment handed to setup() and to `execute` implementations. */
export interface WebFeatureEnvironment {
  readonly id: WebFeatureId
  readonly signal: AbortSignal
  /** Invoke the `execute` of a declared, enabled dependency. */
  use<T = unknown>(id: WebFeatureId, input?: unknown): T
  /** Shared, non-capability cache. Cleaned up when the registry disposes. */
  state<T>(key: string, init: () => T, cleanup?: (value: T) => void | Promise<void>): T
  /** Every effect cleanup must be attached here. Runs on disable/dispose. */
  onDispose(dispose: () => void | Promise<void>): void
  /** Force subscribers to re-read the snapshot (rarely needed). */
  refresh(): void
}

/**
 * A web feature descriptor.
 *
 * `capability` is derived from `id` by defineFeature(): one feature can never
 * advertise a second capability.
 */
export interface WebFeature<P = Record<string, unknown>> {
  readonly id: WebFeatureId
  readonly capability: WebFeatureId
  readonly title: string
  readonly description?: string
  readonly kind: WebFeatureKind
  /** Hard requirements: enabling pulls them in, disabling cascades to them. */
  readonly depends?: readonly WebFeatureId[]
  /** Soft requirements: used if enabled, never blocks the feature. */
  readonly optionalDepends?: readonly WebFeatureId[]
  /** Slot this feature renders into (motion/slot kinds). */
  readonly slot?: string
  /** Component contributed to a slot, or the page component of a view. */
  readonly render?: ComponentType<P>
  /** Ordering inside a slot or the route table. */
  readonly order?: number
  /** Route metadata (view kind). */
  readonly route?: WebRouteMeta
  /** One programmatic action, callable through call()/env.use(). */
  execute?(input: unknown, env: WebFeatureEnvironment): unknown
  setup?(env: WebFeatureEnvironment): void | Promise<void>
  readonly tags?: readonly string[]
}

/** Diagnostics-facing projection of a registered feature (frozen snapshot). */
export interface WebFeatureEntry {
  readonly id: string
  readonly capability: string
  readonly title: string
  readonly description?: string
  readonly kind: WebFeatureKind
  readonly slot?: string
  readonly route?: WebRouteMeta
  readonly order: number
  readonly source?: string
  readonly status: WebFeatureStatus
  readonly error?: string
  readonly depends: readonly string[]
  readonly optionalDepends: readonly string[]
  readonly feature: WebFeature
}

export interface WebNavEntry {
  readonly id: string
  readonly path: string
  readonly titleKey: string
  readonly caption: string
  readonly icon: string
  readonly order: number
}

/**
 * Immutable registry snapshot; identity changes only when the registry does, so
 * it can be fed straight into useSyncExternalStore.
 */
export interface WebFeatureSnapshot {
  readonly revision: number
  readonly features: readonly WebFeatureEntry[]
  readonly byId: Readonly<Record<string, WebFeatureEntry>>
  /** Enabled motion/slot features grouped by slot name. */
  readonly slots: Readonly<Record<string, readonly WebFeatureEntry[]>>
  /** Every view route (enabled and disabled), ordered for the route table. */
  readonly views: readonly WebFeatureEntry[]
  /** Enabled view routes only. */
  readonly routes: readonly WebFeatureEntry[]
  readonly nav: {
    readonly main: readonly WebNavEntry[]
    readonly aux: readonly WebNavEntry[]
  }
}

export class WebFeatureError extends Error {
  readonly code:
    | 'DUPLICATE_CAPABILITY'
    | 'MULTIPLE_CAPABILITIES'
    | 'INVALID_PLUGIN'
    | 'PLUGIN_NOT_FOUND'
    | 'PLUGIN_UNAVAILABLE'
    | 'UNDECLARED_DEPENDENCY'
    | 'DEPENDENCY_CYCLE'
    | 'PLUGIN_BLOCKED'
    | 'DUPLICATE_STATE'
    | 'HOST_DISPOSED'

  constructor(code: WebFeatureError['code'], message: string) {
    super(message)
    this.name = 'WebFeatureError'
    this.code = code
  }
}
