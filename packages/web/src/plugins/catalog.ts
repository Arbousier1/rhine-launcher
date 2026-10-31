/**
 * Plugin catalog.
 *
 * Auto-discovers every *.plugin.ts(x) under ./features and registers its
 * default descriptor. This is the only module that knows the implementations
 * exist; the registry, the slots and the shell stay ignorant of them.
 *
 * Importing this module installs the catalog into the application registry, so
 * the route table and the shell work for any entry point (main.tsx, tests).
 */
import { webPlugins } from './registry.ts'
import type { WebFeatureRegistry } from './registry.ts'
import type { WebFeature } from './types.ts'

interface PluginModule {
  default?: WebFeature
}

const modules = import.meta.glob<PluginModule>('./features/**/*.plugin.{ts,tsx}', { eager: true })

export interface CatalogInstallResult {
  readonly registered: readonly string[]
  readonly failed: readonly { source: string; error: string }[]
}

/** Register every discovered descriptor into a registry (default: the app). */
export function installWebFeatures(registry: WebFeatureRegistry = webPlugins): CatalogInstallResult {
  const registered: string[] = []
  const failed: { source: string; error: string }[] = []

  for (const [source, module] of Object.entries(modules)) {
    const feature = module?.default
    if (!feature) {
      failed.push({ source, error: 'no default feature export' })
      continue
    }
    try {
      registry.register(feature, source)
      registered.push(feature.id)
    } catch (error) {
      failed.push({ source, error: error instanceof Error ? error.message : String(error) })
      if (typeof console !== 'undefined') console.warn('[web-feature] registration failed:', source, error)
    }
  }

  return { registered: Object.freeze(registered), failed: Object.freeze(failed) }
}

/** Installed on import — routes and slots are usable immediately. */
export const WEB_CATALOG: CatalogInstallResult = installWebFeatures()
