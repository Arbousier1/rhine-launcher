/// <reference types="vite/client" />
import { FeatureRuntime, type FeaturePlugin, type StartFeaturesOptions } from '@rhine/plugin-api'
import { LAUNCHER_STATE_KEY, LauncherState } from './launcher-state'

// The directory is a catalog. Every discovered module is one native capability.
const catalog = import.meta.glob<FeaturePlugin>('./launcher-plugins/**/*.plugin.ts', { eager: true, import: 'default' })
export interface LauncherRuntimeHost { runtime: FeatureRuntime; state: LauncherState; ready: Promise<void> }
export function createLauncherRuntime(state = new LauncherState(), options: StartFeaturesOptions = {}): LauncherRuntimeHost {
  const runtime = new FeatureRuntime()
  runtime.state(LAUNCHER_STATE_KEY, () => state, value => value.dispose())
  for (const [source, plugin] of Object.entries(catalog).sort(([a], [b]) => a.localeCompare(b))) runtime.register(plugin, source)
  return { runtime, state, ready: runtime.start(options) }
}
