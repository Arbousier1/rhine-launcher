/**
 * One archive card. Pure presentation: every behaviour (open, focus) is owned
 * by the grid so keyboard navigation stays in one place.
 */
import clsx from 'clsx'
import type { Instance } from '@rhine/core'
import { Badge, Sparkline, StatusDot } from '@/ui'
import { relativeTime, formatPlayTime } from '@/ui/grid-nav.ts'
import { captureCardOpen } from '@/plugins/effects.ts'
import { loaderLabel, memoryLabel } from './archive-logic.ts'

export interface ArchiveCardProps {
  instance: Instance
  number: string
  running: boolean
  selected: boolean
  /** Keyboard cursor is on this card. */
  focused: boolean
  /** Optional recent play-time series for the sparkline. */
  series?: number[]
  onSelect: () => void
  onOpen: () => void
  style?: React.CSSProperties
}

export function ArchiveCard({
  instance,
  number,
  running,
  selected,
  focused,
  series,
  onSelect,
  onOpen,
  style,
}: ArchiveCardProps) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      aria-label={instance.name}
      tabIndex={focused ? 0 : -1}
      className={clsx('rh-card', selected && 'is-selected', focused && 'is-focused')}
      style={style}
      onClick={(event) => {
        onSelect()
        // Record the card box so the detail page can grow out of it (FLIP),
        // but only when the card-expand motion plugin is enabled.
        captureCardOpen(event.currentTarget, instance.name)
        onOpen()
      }}
      onMouseEnter={onSelect}
      onFocus={onSelect}
    >
      <span className="rh-card__bar" aria-hidden="true" />
      <span className="rh-card__top">
        <span className="rh-card__number">{number}</span>
        <span className="rh-card__status">
          {running ? (
            <>
              <StatusDot tone="accent" pulse />
              运行中
            </>
          ) : (
            <>
              <StatusDot tone="muted" />
              {instance.lastLaunchedAt ? '空闲' : '新档案'}
            </>
          )}
        </span>
      </span>

      <span className="rh-card__name" title={instance.name}>
        {instance.name}
      </span>

      <span className="rh-card__meta">
        <Badge tone="muted" mono>
          {instance.gameVersion || '未安装'}
        </Badge>
        <Badge tone={instance.loaders?.some((loader) => loader.kind !== 'vanilla') ? 'accent' : 'muted'}>
          {loaderLabel(instance.loaders)}
        </Badge>
      </span>

      <span className="rh-card__spacer" />

      <span className="rh-card__foot">
        <span className="rh-card__stats">
          <span className="rh-card__stat">
            <span className="rh-caption">LAST</span>
            <span className="rh-card__statvalue">{relativeTime(instance.lastLaunchedAt)}</span>
          </span>
          <span className="rh-card__stat">
            <span className="rh-caption">TIME</span>
            <span className="rh-card__statvalue">{formatPlayTime(instance.playTimeMs)}</span>
          </span>
          <span className="rh-card__stat">
            <span className="rh-caption">MEM</span>
            <span className="rh-card__statvalue">{memoryLabel(instance.memory?.minMb, instance.memory?.maxMb)}</span>
          </span>
        </span>
        <Sparkline
          className="rh-card__spark"
          data={series ?? []}
          width={72}
          height={22}
          tone={running ? 'accent' : 'muted'}
          ariaLabel={'游玩趋势 ' + instance.name}
        />
      </span>
    </button>
  )
}