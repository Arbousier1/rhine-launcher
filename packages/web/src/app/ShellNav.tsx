/**
 * Left navigation rail.
 *
 * Destinations are derived from the feature registry (one view plugin owns its
 * route + label); the rail itself hard-codes nothing. The running-session block
 * is its own slot plugin, so switching it off only removes that block.
 */
import clsx from 'clsx'
import type { ReactElement } from 'react'
import { NavLink } from 'react-router-dom'
import { StatusDot } from '@/ui'
import {
  ArchiveIcon, CoffeeIcon, CubeIcon, GridIcon, LayersIcon, RhineMark, SlidersIcon, TagIcon, TerminalIcon, UserIcon,
} from '@/ui/icons'
import { useAppStore } from '@/app/data.ts'
import { useI18n } from '@/app/theme.ts'
import { PluginSlot } from '@/plugins/slots.tsx'
import type { WebNavEntry } from '@/plugins/types.ts'
import type { Translator } from '@/app/i18n'

export interface ShellNavProps {
  items: {
    main: readonly WebNavEntry[]
    aux: readonly WebNavEntry[]
  }
}

const ICONS: Record<string, (props: { className?: string }) => ReactElement> = {
  archive: ArchiveIcon,
  versions: LayersIcon,
  mods: CubeIcon,
  market: TagIcon,
  accounts: UserIcon,
  java: CoffeeIcon,
  logs: TerminalIcon,
  settings: SlidersIcon,
  plugins: GridIcon,
}

export function ShellNav({ items }: ShellNavProps) {
  const { t } = useI18n()
  const connection = useAppStore((state) => state.connection)
  const app = useAppStore((state) => state.app)

  return (
    <nav className="rh-nav" aria-label="主导航">
      <div className="rh-nav__brand">
        <RhineMark className="rh-nav__mark" />
        <span className="rh-nav__brandtext">
          <span className="rh-nav__brandname">{t('app.brand')}</span>
          <span className="rh-nav__brandsub">{t('app.brandSub')}</span>
        </span>
      </div>

      <div className="rh-nav__scroll">
        <NavGroup label={t('nav.group.main')} items={items.main} t={t} />
        <NavGroup label={t('nav.group.aux')} items={items.aux} t={t} />
      </div>

      <div className="rh-nav__foot">
        <PluginSlot
          name="shell.nav.sessions"
          fallback={
            <div className="rh-nav__statusline">
              <StatusDot tone="muted" />
              <span className="rh-truncate">{t('shell.noSession')}</span>
            </div>
          }
        />

        <div className="rh-nav__statusline">
          <StatusDot
            tone={connection === 'online' ? 'ok' : connection === 'connecting' ? 'warn' : 'danger'}
            pulse={connection === 'connecting'}
          />
          <span className="rh-truncate">
            {connection === 'online'
              ? t('shell.connection.online')
              : connection === 'connecting'
                ? t('shell.connection.connecting')
                : t('shell.connection.offline')}
          </span>
        </div>

        <div className="rh-nav__meta">
          <span>{app?.version ? 'v' + app.version : '—'}</span>
          <span>{app?.platform ?? ''}</span>
        </div>
      </div>
    </nav>
  )
}

function NavGroup({
  label,
  items,
  t,
}: {
  label: string
  items: readonly WebNavEntry[]
  t: Translator
}) {
  if (items.length === 0) return null
  return (
    <div className="rh-nav__group">
      <span className="rh-nav__grouplabel rh-caption">{label}</span>
      {items.map((item) => (
        <NavItem key={item.id} item={item} t={t} />
      ))}
    </div>
  )
}

function NavItem({ item, t }: { item: WebNavEntry; t: Translator }) {
  const Icon = ICONS[item.icon] ?? GridIcon
  return (
    <NavLink
      to={item.path}
      end={item.path === '/'}
      className={({ isActive }) => clsx('rh-nav__item', isActive && 'is-active')}
    >
      <span className="rh-nav__icon">
        <Icon />
      </span>
      <span className="rh-nav__label">{t(item.titleKey)}</span>
      <span className="rh-nav__caption">{item.caption}</span>
    </NavLink>
  )
}