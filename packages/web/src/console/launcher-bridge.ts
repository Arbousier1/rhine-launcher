/// <reference types="vite/client" />
/** Thin compatibility facade. I/O lives in independently unloadable native features. */
import type { FeatureRuntime } from '@rhine/plugin-api'
import { createLauncherRuntime, type LauncherRuntimeHost } from './launcher-runtime'
import { LauncherState, launcherIssue, type LauncherAction, type LauncherAccount, type LauncherInstance, type LauncherInstanceConfig, type LauncherInstancePatch, type LauncherMod, type LauncherSession, type LauncherSnapshot } from './launcher-state'
export type { LauncherAction, LauncherAccount, LauncherConnection, LauncherInstance, LauncherInstanceConfig, LauncherInstancePatch, LauncherIssue, LauncherMod, LauncherSession, LauncherSnapshot, LauncherTask, LauncherUnavailable } from './launcher-state'
export { LAUNCHER_ACCOUNT_STORAGE_KEY } from './launcher-state'

let state = new LauncherState()
let host: LauncherRuntimeHost | undefined
function launcherHost(): LauncherRuntimeHost {
  if (!host) {
    if (state.closed) state = new LauncherState()
    host = createLauncherRuntime(state)
  }
  return host
}
export function getLauncherRuntime(): FeatureRuntime { return launcherHost().runtime }
export function getLauncherSnapshot(): LauncherSnapshot { return state.snapshot }
export function launcherInstances(): LauncherInstance[] { return state.snapshot.instances }
export function launcherSessions(): LauncherSession[] { return state.snapshot.sessions }
export function launcherAccounts(): LauncherAccount[] { return state.snapshot.accounts }
export function isBootstrapped(): boolean { return state.bootstrapped }
export function subscribeInstances(listener: (instances: LauncherInstance[]) => void): () => void { return state.subscribeInstances(listener) }
export function subscribeStatus(listener: () => void): () => void { return state.subscribeStatus(listener) }
export function sessionFor(instanceId: string): LauncherSession | undefined { return state.sessionFor(instanceId) }
export function setSelectedAccount(id: string): void { state.setSelectedAccount(id) }

function invoke<T>(feature: string, input: unknown, action: LauncherAction, instanceId?: string): Promise<T> {
  const current = launcherHost()
  const fail = (error: unknown): never => { current.state.recordActionError(action, instanceId, error); throw error }
  const run = () => current.runtime.call<T | Promise<T>>(feature, input)
  try { return Promise.resolve(current.runtime.has(feature) ? run() : current.ready.then(run)).catch(fail) }
  catch (error) { return Promise.reject(error).catch(fail) }
}
/** Every call refreshes HTTP, including retries. Opting out of realtime disables only that feature. */
export function loadLauncher(options: { realtime?: boolean } = {}): Promise<void> {
  const current = launcherHost()
  const refresh = async () => {
    if (options.realtime === false) await current.runtime.disable('launcher.events.connect')
    else if (options.realtime === true) await current.runtime.enable('launcher.events.connect')
    await current.runtime.call<Promise<void>>('launcher.bootstrap')
    if (current.runtime.has('launcher.events.connect')) {
      try { current.runtime.call('launcher.events.connect') }
      catch (error) { current.state.setConnection('disconnected', launcherIssue(error)) }
    }
  }
  current.state.patch({ status: 'loading', error: null })
  return (current.runtime.has('launcher.bootstrap') ? refresh() : current.ready.then(refresh)).catch(error => { current.state.failBootstrap(error); throw error })
}
export function launchInstance(id: string): Promise<LauncherSession> { return invoke('launcher.launch.start', { id }, 'launch', id) }
export function stopInstance(sessionId: string): Promise<void> {
  return invoke('launcher.session.stop', { sessionId }, 'stop', state.snapshot.sessions.find(item => item.id === sessionId)?.instanceId)
}
export function createInstance(config: LauncherInstanceConfig): Promise<LauncherInstance> { return invoke('launcher.instance.create', config, 'create') }
export function updateInstance(id: string, patch: LauncherInstancePatch): Promise<LauncherInstance> { return invoke('launcher.instance.update', { id, patch }, 'update', id) }
export function addOfflineAccount(name: string): Promise<LauncherAccount> { return invoke('launcher.account.offline', { name }, 'account') }
export function readMods(id: string): Promise<LauncherMod[]> { return invoke('launcher.mods.list', { id }, 'mods', id) }
export function revealPath(path: string): Promise<void> { return invoke('launcher.system.reveal', { path }, 'reveal') }
export async function disposeLauncher(): Promise<void> {
  const current = host
  if (!current) { state.dispose(); return }
  await current.runtime.dispose()
  if (host === current) host = undefined
}
if (import.meta.hot) import.meta.hot.dispose(() => { void disposeLauncher() })
