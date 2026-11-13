import { defineFeature, type FeatureEnvironment } from '@rhine/plugin-api'
export interface OriginalUiInput { root: HTMLElement; entry: string }
export interface OriginalUiHandle { dispose(): void }
interface Mounts { values: Map<HTMLElement, OriginalUiHandle> }
function mounts(env: FeatureEnvironment) { return env.state<Mounts>('original.ellan.ui.mounts', () => ({ values: new Map() })) }
/** Entire original Vue document, not one recreated page inside the old shell. */
export default defineFeature<OriginalUiInput, OriginalUiHandle>({
  id: 'ui.ellan', capability: 'ui.ellan', title: '艾尔岚',
  setup(env) { const state = mounts(env); env.onDispose(() => { for (const handle of state.values.values()) handle.dispose(); state.values.clear() }) },
  execute(input, env) {
    env.signal.throwIfAborted()
    const state = mounts(env)
    state.values.get(input.root)?.dispose()
    const entry = new URL(input.entry, input.root.ownerDocument.location.href)
    const current = new URL(input.root.ownerDocument.location.href)
    if (entry.protocol !== current.protocol || entry.host !== current.host || entry.username || entry.password) throw new Error('Original UI must use the owning application origin')
    const frame = input.root.ownerDocument.createElement('iframe')
    frame.src = entry.href
    frame.title = '艾尔岚'
    frame.allow = 'clipboard-read; clipboard-write; fullscreen'
    frame.style.cssText = 'position:fixed;inset:0;width:100%;height:100%;border:0;display:block;background:#0b1a16'
    input.root.replaceChildren(frame)
    let disposed = false
    const handle = { dispose() { if (disposed) return; disposed = true; frame.remove(); state.values.delete(input.root) } }
    state.values.set(input.root, handle)
    return handle
  },
})
