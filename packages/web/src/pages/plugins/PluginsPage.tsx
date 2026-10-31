/**
 * Plugins page (view.plugins).
 *
 * Two independent inventories:
 * - the browser registry: every page / motion / shell widget is one feature and
 *   can be switched off without touching its siblings;
 * - the backend feature runtime, reached through a small typed adapter
 *   (/api/plugins/:id/enable|disable) because the shared api client is owned by
 *   the Lead.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Badge, Button, Panel, Skeleton, Switch, toast } from '@/ui'
import type { BadgeProps } from '@/ui'
import { PageHeader } from '@/ui/page-head.tsx'
import { Notice } from '@/features/common/toolbar.tsx'
import { useWebPlugins } from '@/plugins/hooks.ts'
import { webPlugins } from '@/plugins/registry.ts'
import {
  BackendFeatureError, listBackendFeatures, setBackendFeatureEnabled,
} from '@/plugins/backend.ts'
import type { BackendFeatureInfo } from '@/plugins/backend.ts'
import type { WebFeatureEntry, WebFeatureKind, WebFeatureStatus } from '@/plugins/types.ts'
import { useI18n } from '@/app/theme.ts'
import './plugins.css'

const GROUPS: readonly { kind: WebFeatureKind; labelKey: string }[] = [
  { kind: 'view', labelKey: 'plugins.group.view' },
  { kind: 'motion', labelKey: 'plugins.group.motion' },
  { kind: 'slot', labelKey: 'plugins.group.shell' },
  { kind: 'effect', labelKey: 'plugins.group.effect' },
]

const STATUS_TONE: Record<WebFeatureStatus, BadgeProps['tone']> = {
  enabled: 'ok',
  disabled: 'muted',
  blocked: 'warn',
  failed: 'danger',
  loading: 'accent',
}

type BackendState =
  | { status: 'loading' }
  | { status: 'ready'; items: BackendFeatureInfo[] }
  | { status: 'unsupported'; items: [] }
  | { status: 'error'; items: []; error: string }

export default function PluginsPage() {
  const { t } = useI18n()
  const snapshot = useWebPlugins()
  const [pending, setPending] = useState<string | null>(null)
  const [backend, setBackend] = useState<BackendState>({ status: 'loading' })
  const [backendPending, setBackendPending] = useState<string | null>(null)
  const features = snapshot.features

  const loadBackend = useCallback(async () => {
    setBackend({ status: 'loading' })
    try {
      const items = await listBackendFeatures()
      setBackend({ status: 'ready', items })
    } catch (error) {
      const unsupported = error instanceof BackendFeatureError && error.unsupported
      setBackend(
        unsupported
          ? { status: 'unsupported', items: [] }
          : {
              status: 'error',
              items: [],
              error: error instanceof Error ? error.message : String(error),
            },
      )
    }
  }, [])

  useEffect(() => {
    void loadBackend()
  }, [loadBackend])

  const toggle = useCallback(async (entry: WebFeatureEntry, next: boolean) => {
    setPending(entry.id)
    try {
      await webPlugins.toggle(entry.id, next)
    } catch (error) {
      toast.show({
        level: 'error',
        message: '切换失败：' + (error instanceof Error ? error.message : String(error)),
      })
    } finally {
      setPending(null)
    }
  }, [])

  const enableAll = useCallback(async () => {
    setPending('*')
    try {
      for (const entry of features) {
        if (entry.status === 'enabled') continue
        try {
          await webPlugins.enable(entry.id)
        } catch {
          /* a blocked plugin is reported by its row */
        }
      }
    } finally {
      setPending(null)
    }
  }, [features])

  const toggleBackend = useCallback(
    async (item: BackendFeatureInfo, next: boolean) => {
      setBackendPending(item.id)
      try {
        await setBackendFeatureEnabled(item.id, next)
        toast.show({ level: 'ok', message: item.id + (next ? ' 已启用' : ' 已停用') })
        await loadBackend()
      } catch (error) {
        toast.show({
          level: 'error',
          message:
            '后端切换失败：' + (error instanceof Error ? error.message : String(error)),
        })
      } finally {
        setBackendPending(null)
      }
    },
    [loadBackend],
  )

  const grouped = useMemo(
    () =>
      GROUPS.map((group) => ({
        ...group,
        items: features.filter((entry) => entry.kind === group.kind),
      })).filter((group) => group.items.length > 0),
    [features],
  )

  return (
    <div className="rh-plugins">
      <PageHeader
        caption={t('plugins.caption')}
        title={t('plugins.title')}
        description={t('plugins.subtitle')}
        actions={
          <>
            <Badge tone="muted" mono>
              {t('plugins.pageHint', { count: features.length })}
            </Badge>
            <Button variant="ghost" onClick={() => void enableAll()} loading={pending === '*'}>
              {t('plugins.reset')}
            </Button>
          </>
        }
      />

      {grouped.map((group) => (
        <Panel
          key={group.kind}
          caption={group.kind.toUpperCase()}
          title={t(group.labelKey)}
        >
          <div className="rh-plugins__list">
            {group.items.map((entry) => {
              const active = entry.status === 'enabled' || entry.status === 'loading'
              return (
                <div className="rh-plugins__row" key={entry.id} data-status={entry.status}>
                  <div className="rh-plugins__main">
                    <span className="rh-plugins__title">{entry.title}</span>
                    <code className="rh-plugins__id">{entry.id}</code>
                    {entry.description ? (
                      <span className="rh-plugins__desc">{entry.description}</span>
                    ) : null}
                    {entry.depends.length > 0 ? (
                      <span className="rh-plugins__deps">
                        {t('plugins.backend.deps')}: {entry.depends.join(' · ')}
                      </span>
                    ) : null}
                    {entry.error ? <span className="rh-plugins__error">{entry.error}</span> : null}
                  </div>
                  <div className="rh-plugins__control">
                    <Badge tone={STATUS_TONE[entry.status]} mono>
                      {t('plugins.status.' + entry.status)}
                    </Badge>
                    <Switch
                      checked={active}
                      disabled={pending !== null}
                      onCheckedChange={(next) => void toggle(entry, next)}
                      label={entry.title}
                    />
                  </div>
                </div>
              )
            })}
          </div>
        </Panel>
      ))}

      <Panel
        caption="BACKEND"
        title={t('plugins.backend.title')}
        actions={
          <Button
            size="sm"
            variant="quiet"
            onClick={() => void loadBackend()}
            loading={backend.status === 'loading'}
          >
            {t('common.refresh')}
          </Button>
        }
      >
        <p className="rh-plugins__desc" style={{ marginBottom: 10 }}>
          {t('plugins.backend.hint')}
        </p>
        {backend.status === 'loading' ? <Skeleton lines={3} /> : null}
        {backend.status === 'unsupported' ? (
          <Notice level="warn" title={t('plugins.backend.title')}>
            {t('plugins.backend.unavailable')}
          </Notice>
        ) : null}
        {backend.status === 'error' ? (
          <Notice level="danger" title={t('error.panel.title')}>
            {backend.error}
          </Notice>
        ) : null}
        {backend.status === 'ready' && backend.items.length === 0 ? (
          <p className="rh-plugins__desc">{t('plugins.backend.empty')}</p>
        ) : null}
        {backend.status === 'ready' && backend.items.length > 0 ? (
          <div>
            {backend.items.map((item) => {
              const enabled = item.status === 'enabled'
              const state:WebFeatureStatus = ['enabled','disabled','blocked','failed','loading'].includes(item.status) ? item.status as WebFeatureStatus : 'failed'
              return (
                <div className="rh-plugins__backendrow" key={item.id}>
                  <div className="rh-plugins__backendmain">
                    <span className="rh-plugins__title">{item.title}</span>
                    <code className="rh-plugins__id">{item.id}</code>
                    {item.depends && item.depends.length > 0 ? (
                      <span className="rh-plugins__deps">
                        {t('plugins.backend.deps')}: {item.depends.join(' · ')}
                      </span>
                    ) : null}
                  </div>
                  <div className="rh-plugins__backendactions">
                    <Badge tone={STATUS_TONE[state]} mono>
                      {t('plugins.status.'+state)}
                    </Badge>
                    <Button
                      size="sm"
                      variant={enabled ? 'ghost' : 'primary'}
                      loading={backendPending === item.id}
                      onClick={() => void toggleBackend(item, !enabled)}
                    >
                      {enabled ? t('plugins.toggle.disable') : t('plugins.toggle.enable')}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        ) : null}
      </Panel>
    </div>
  )
}