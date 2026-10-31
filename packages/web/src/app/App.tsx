/**
 * Application shell.
 *
 * The host renders slots and registry-derived routes — nothing else. Theme
 * cycling, locale cycling, the shortcut sheet, the running-session list, the
 * boot sequence, the toast surface and every motion are independent feature
 * plugins; disabling one removes exactly that piece.
 */
import { useMemo } from 'react'
import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'
import { ErrorBoundary } from './ErrorBoundary.tsx'
import { ShellNav } from './ShellNav.tsx'
import { useI18n } from './theme.ts'
import { useWebPlugins } from '@/plugins/hooks.ts'
import { PluginSlot } from '@/plugins/slots.tsx'
import { matchRouteEntry } from '@/plugins/registry.ts'

export function App({ children }: { children?: ReactNode }) {
  const { t } = useI18n()
  const location = useLocation()
  const snapshot = useWebPlugins()

  const matched = useMemo(
    () => matchRouteEntry(snapshot.views, location.pathname),
    [snapshot.views, location.pathname],
  )
  const caption = matched?.route?.caption ?? 'ARCHIVE'
  const titleKey = matched?.route?.titleKey ?? 'archive.title'
  const title = t(titleKey)

  return (
    <PluginSlot name="ui.frame">
      <PluginSlot name="shell.chrome" />
      <a className="rh-visually-hidden" href="#main">
        {t('shell.skipToContent')}
      </a>

      <div className="rh-shell">
        <ShellNav items={snapshot.nav} />

        <div className="rh-main">
          <header className="rh-topbar">
            <PluginSlot
              name="motion.scanline"
              props={{ className: 'rh-topbar__scan', variant: 'edge', period: 7 }}
            />
            <div className="rh-topbar__left">
              <span className="rh-caption rh-topbar__crumb">{caption}</span>
              <span className="rh-topbar__title">{title}</span>
            </div>
            <div className="rh-topbar__right">
              <PluginSlot name="shell.topbar.primary" />
              <span className="rh-topbar__divider" aria-hidden="true" />
              <PluginSlot name="shell.topbar.tools" />
            </div>
          </header>

          <main className="rh-content" id="main">
            <div className="rh-content__inner">
              <ErrorBoundary>{children ?? null}</ErrorBoundary>
            </div>
          </main>
        </div>
      </div>

      <PluginSlot name="motion.boot" />
    </PluginSlot>
  )
}
