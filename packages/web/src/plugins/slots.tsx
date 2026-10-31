/**
 * Slot host.
 *
 * Pages never import a motion implementation: they render <PluginSlot
 * name="motion.dust" …/> and the registry decides whether anything is mounted.
 * Every contributed component sits behind its own error boundary, so a broken
 * plugin removes itself instead of blanking the page, and the registry records
 * the failure for the plugin manager.
 */
import { Component, useMemo } from 'react'
import { EffectOwnerContext } from './owned-effect.tsx'
import type { ComponentType, ReactNode } from 'react'
import { useSlotFeatures, useWebRegistry } from './hooks.ts'
import type { WebFeatureEntry } from './types.ts'
import type { WebFeatureRegistry } from './registry.ts'

const EMPTY_PROPS: Record<string, unknown> = {}

interface BoundaryProps {
  id: string
  registry: WebFeatureRegistry
  children: ReactNode
}

interface BoundaryState {
  failed: boolean
}

/** Renders nothing when the plugin below it throws. */
class RenderBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false }

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true }
  }

  componentDidCatch(error: unknown): void {
    this.props.registry.reportFailure(this.props.id, error)
  }

  render(): ReactNode {
    return this.state.failed ? null : this.props.children
  }
}

export interface PluginSlotProps {
  /** Slot name, e.g. "motion.dust" or "shell.topbar.tools". */
  name: string
  /** Props forwarded to every contributor (children are merged in). */
  props?: Record<string, unknown>
  /** Rendered when the slot has no enabled contributor. */
  fallback?: ReactNode
  /** Content for wrapper slots (toggles, frames). */
  children?: ReactNode
}

export function PluginSlot({ name, props, fallback, children }: PluginSlotProps) {
  const registry = useWebRegistry()
  const providers = useSlotFeatures(name)
  const merged = props ?? EMPTY_PROPS

  if (providers.length === 0) {
    if (fallback !== undefined) return <>{fallback}</>
    if (children !== undefined && typeof merged.className === 'string') {
      // Wrapper slot with no provider: keep the layout, drop the behaviour.
      return <div className={merged.className}>{children}</div>
    }
    return <>{children ?? null}</>
  }

  return (
    <>
      {providers.map((entry) => {
        const Render = entry.feature.render as ComponentType<Record<string, unknown>> | undefined
        if (!Render) return null
        return (
          <RenderBoundary key={entry.id} id={entry.id} registry={registry}>
            <OwnedRender registry={registry} entry={entry} props={merged}>{children}</OwnedRender>
          </RenderBoundary>
        )
      })}
    </>
  )
}

/** Render one view feature (used by the registry-derived route table). */
export function FeatureView({ entry }: { entry: WebFeatureEntry }) {
  const registry = useWebRegistry()
  const Render = entry.feature.render
  if (!Render) return null
  return (
    <RenderBoundary id={entry.id} registry={registry}>
      <OwnedRender registry={registry} entry={entry} />
    </RenderBoundary>
  )
}
function OwnedRender({registry,entry,props=EMPTY_PROPS,children}:{registry:WebFeatureRegistry;entry:WebFeatureEntry;props?:Record<string,unknown>;children?:ReactNode}){
 const owner=useMemo(()=>({own:(cleanup:()=>void|Promise<void>)=>registry.ownEffect(entry.id,cleanup)}),[registry,entry.id])
 const Render=entry.feature.render as ComponentType<Record<string,unknown>>
 return <EffectOwnerContext.Provider value={owner}><Render {...props}>{children}</Render></EffectOwnerContext.Provider>
}
