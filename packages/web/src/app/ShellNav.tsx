/**
 * Left navigation rail — Ellan Launcher 形态（窄图标栏）。
 *
 * 目的地仍由注册表派生，一条 view 插件占一条路由；这里不硬编码任何页面。
 * 外观复刻自其 views/AppSideBarClassic.vue：竖向图标按钮、实例头像与底部入口。
 */
import type { ReactElement } from 'react'
import { NavLink } from 'react-router-dom'
import { Tooltip } from '@/ui'
import {
  ArchiveIcon, CoffeeIcon, CubeIcon, GridIcon, LayersIcon, SlidersIcon, TagIcon, TerminalIcon, UserIcon,
} from '@/ui/icons'
import { useAppStore } from '@/app/data.ts'
import { useI18n } from '@/app/theme.ts'
import { PluginSlot } from '@/plugins/slots.tsx'
import type { WebNavEntry } from '@/plugins/types.ts'

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
  const accounts = useAppStore((state) => state.accounts)
  const account = accounts?.[0]
  const all = [...items.main, ...items.aux]
  const primary = all.slice(0, 4)
  const rest = all.slice(4)

  return (
    <nav className="ellan-nav" aria-label="主导航">
      <div className="ellan-nav__avatar" title={account?.name ?? '未登录'}>
        {(account?.name ?? '?').slice(0, 1).toUpperCase()}
      </div>
      {primary.map((entry) => (
        <RailItem key={entry.id} entry={entry} t={t} />
      ))}
      <div className="ellan-nav__divider" />
      <div className="ellan-nav__scroll">
        {rest.map((entry) => (
          <RailItem key={entry.id} entry={entry} t={t} />
        ))}
      </div>
      <div className="ellan-nav__spacer" />
      <PluginSlot name="shell.nav.sessions" />
    </nav>
  )
}

function RailItem({ entry, t }: { entry: WebNavEntry; t: (key: string) => string }) {
  const Icon = ICONS[entry.icon ?? ''] ?? ArchiveIcon
  return (
    <Tooltip content={t(entry.titleKey ?? entry.id)} side="right" portal className="ellan-nav__tooltip-host">
      <NavLink to={entry.path} end={entry.path === '/'}
        className={({ isActive }) => 'ellan-nav__item' + (isActive ? ' is-active' : '')}
        aria-label={t(entry.titleKey ?? entry.id)}>
        <Icon />
      </NavLink>
    </Tooltip>
  )
}
