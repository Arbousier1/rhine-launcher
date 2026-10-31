/**
 * Route table derived from the feature registry.
 *
 * One view plugin owns one route; this module never imports a page. Disabled
 * views keep their path and render a recoverable notice instead of a blank
 * 404. The route frame (exit/enter transition) is itself a slot plugin.
 */
import '@/plugins/catalog.ts'
import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import type { Location } from 'react-router-dom'
import { Panel, Skeleton } from '@/ui'
import { useI18n } from '@/app/theme.ts'
import { useWebPlugins } from '@/plugins/hooks.ts'
import { FeatureView, PluginSlot } from '@/plugins/slots.tsx'
import { DisabledFeatureNotice } from '@/plugins/feature-disabled.tsx'
import { ErrorBoundary } from './ErrorBoundary.tsx'

export function AppRoutes() {
  const { t } = useI18n()
  const location = useLocation()
  const snapshot = useWebPlugins()

  const renderRoutes = (target: Location) => (
    <Routes location={target}>
      {snapshot.views.map((entry) =>
        entry.status === 'enabled' ? (
          <Route
            key={entry.id}
            path={entry.route?.path}
            element={
              <ErrorBoundary>
                <FeatureView entry={entry} />
              </ErrorBoundary>
            }
          />
        ) : (
          <Route
            key={entry.id}
            path={entry.route?.path}
            element={<DisabledFeatureNotice entry={entry} />}
          />
        ),
      )}
      {snapshot.views.flatMap((entry) =>
        (entry.route?.aliases ?? []).map((alias) => (
          <Route
            key={entry.id + '->' + alias}
            path={alias}
            element={<Navigate to={entry.route?.path ?? '/'} replace />}
          />
        )),
      )}
      <Route path="*" element={<NotFound title={t('error.unknown.title')} />} />
    </Routes>
  )

  return (
    <PluginSlot
      name="motion.route-transition"
      props={{ location, render: renderRoutes }}
      fallback={renderRoutes(location)}
    />
  )
}

function NotFound({ title }: { title: string }) {
  return (
    <Panel>
      <p className="rh-field__hint">{title}</p>
    </Panel>
  )
}

/** Shared suspense fallback used by lazily loaded views. */
export function RouteFallback(): ReactNode {
  return (
    <Panel padded>
      <Skeleton lines={4} />
    </Panel>
  )
}

/** Wrap a view in Suspense (available for future lazy routes). */
export function withSuspense(node: ReactNode): ReactNode {
  return <Suspense fallback={<RouteFallback />}>{node}</Suspense>
}

export { lazy }