/**
 * Version library page.
 *
 * Three tabs: the remote manifest (with group filters and a search box), the
 * locally installed versions, and a loader browser that queries builds for a
 * chosen game version. Installation always goes through a backend task, so the
 * page can show progress without blocking the UI.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LoaderKind, LoaderVersion, RemoteVersion, TaskSnapshot } from '@rhine/core'
import { api } from '@/api/client'
import {
  Badge, Button, EmptyState, Field, IconButton, Input, Panel, Select, Skeleton, Tabs, Tooltip, toast,
} from '@/ui'
import { DownloadIcon, RefreshIcon, SearchIcon } from '@/ui/icons'
import { PageHeader } from '@/ui/page-head.tsx'
import { PluginSlot } from '@/plugins/slots.tsx'
import { Progress } from '@/ui/progress.tsx'
import { useAppStore } from '@/app/data.ts'
import { formatDate, useI18n } from '@/app/theme.ts'
import { InstallVersionDialog } from './InstallVersionDialog.tsx'
import {
  GROUP_LABELS, INSTALL_LOADERS, countByGroup, filterVersions, isInstalled,
  sortInstalled, versionLabel,
} from './versions-logic.ts'
import type { VersionGroup } from './versions-logic.ts'
import './versions.css'

type VersionsTab = 'remote' | 'installed' | 'loaders'

export default function VersionsPage() {
  const { t } = useI18n()
  const tasks = useAppStore((state) => state.tasks)

  const [tab, setTab] = useState<VersionsTab>('remote')
  const [remote, setRemote] = useState<RemoteVersion[] | null>(null)
  const [installed, setInstalled] = useState<string[] | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState<VersionGroup | 'all'>('release')
  const [selected, setSelected] = useState<string | null>(null)
  const [installOpen, setInstallOpen] = useState(false)
  const [installTarget, setInstallTarget] = useState<string | null>(null)
  const [loaderKind, setLoaderKind] = useState<LoaderKind>('fabric')
  const [loaderGame, setLoaderGame] = useState('')
  const [loaderList, setLoaderList] = useState<LoaderVersion[] | null>(null)
  const [loaderLoading, setLoaderLoading] = useState(false)
  const [trackedTask, setTrackedTask] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const [versions, local] = await Promise.all([api.versions.remote(), api.versions.installed()])
      setRemote(versions)
      setInstalled(local)
      if (!loaderGame && versions.length > 0) {
        const latest = versions.find((item) => item.type === 'release') ?? versions[0]
        setLoaderGame(latest.id)
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
      setRemote((current) => current ?? [])
      setInstalled((current) => current ?? [])
    } finally {
      setLoading(false)
    }
  }, [loaderGame])

  useEffect(() => {
    void load()
  }, [load])

  // Loader builds for the loader browser.
  useEffect(() => {
    if (tab !== 'loaders' || !loaderGame) return
    let cancelled = false
    setLoaderLoading(true)
    api.loaders(loaderKind, loaderGame)
      .then((list) => {
        if (!cancelled) setLoaderList(list)
      })
      .catch(() => {
        if (!cancelled) setLoaderList([])
      })
      .finally(() => {
        if (!cancelled) setLoaderLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [tab, loaderKind, loaderGame])

  const counts = useMemo(() => countByGroup(remote ?? []), [remote])
  const rows = useMemo(
    () => filterVersions({ versions: remote ?? [], query, group }),
    [remote, query, group],
  )
  const installedSorted = useMemo(() => sortInstalled(installed ?? []), [installed])
  const tracked = useMemo(
    () => (trackedTask ? tasks.find((task) => task.id === trackedTask) ?? null : null),
    [trackedTask, tasks],
  )

  const startInstall = (id: string | null) => {
    setInstallTarget(id)
    setInstallOpen(true)
  }

  return (
    <div className="rh-versions">
      <PageHeader
        caption={t('versions.caption')}
        title={t('versions.title')}
        description={t('versions.subtitle')}
        actions={
          <>
            <IconButton label={t('versions.action.refresh')} variant="ghost" onClick={() => void load()}>
              <RefreshIcon />
            </IconButton>
            <Button variant="primary" leading={<DownloadIcon />} onClick={() => startInstall(selected)}>
              {t('versions.action.install')}
            </Button>
          </>
        }
      />

      {tracked ? <TaskProgress task={tracked} /> : null}

      <Tabs
        value={tab}
        onChange={(key) => setTab(key as VersionsTab)}
        ariaLabel={t('versions.title')}
        items={[
          { key: 'remote', label: t('versions.tab.remote'), count: remote?.length },
          { key: 'installed', label: t('versions.tab.installed'), count: installed?.length },
          { key: 'loaders', label: t('versions.tab.loaders') },
        ]}
        className="rh-versions__tabs"
      />

      {error ? (
        <div className="rh-archive__error" role="alert" style={{ marginTop: 16 }}>
          <span>{error}</span>
          <Button size="sm" variant="ghost" onClick={() => void load()}>
            {t('common.retry')}
          </Button>
        </div>
      ) : null}

      <div style={{ paddingTop: 18 }}>
        {tab === 'remote' ? (
          <Panel padded={false} caption="MANIFEST" title={t('versions.tab.remote')}>
            <div className="rh-versions__filters" style={{ padding: '0 0 16px' }}>
              <span style={{ width: 260 }}>
                <Input
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder={t('versions.search.placeholder')}
                  leading={<SearchIcon />}
                  aria-label={t('common.search')}
                />
              </span>
              <div className="rh-filtergroup" role="group">
                {(['all', 'release', 'snapshot', 'old'] as const).map((key) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={group === key}
                    className={'rh-filtergroup__item' + (group === key ? ' is-active' : '')}
                    onClick={() => setGroup(key)}
                  >
                    {key === 'all' ? t('versions.filter.all') : key === 'old' ? t('versions.filter.old') : GROUP_LABELS[key]}
                    <Badge tone="muted">{counts[key]}</Badge>
                  </button>
                ))}
              </div>
              <span className="rh-toolbar__spacer" />
              <span className="rh-toolbar__meta">{t('versions.remote.count', { count: rows.length })}</span>
            </div>

            {loading && !remote ? (
              <Skeleton lines={8} />
            ) : rows.length === 0 ? (
              <EmptyState
                title={t('versions.empty.title')}
                description={t('versions.empty.desc')}
                action={
                  <Button variant="ghost" onClick={() => void load()}>
                    {t('common.retry')}
                  </Button>
                }
              />
            ) : (
              <div className="rh-versions__scroll">
                <div className="rh-versiontable">
                  <div className="rh-versiontable__head">
                    <span>{t('versions.col.version')}</span>
                    <span>{t('versions.col.type')}</span>
                    <span>{t('versions.col.released')}</span>
                    <span style={{ textAlign: 'right' }}>{t('versions.col.actions')}</span>
                  </div>
                  {rows.map((version, index) => {
                    const present = isInstalled(installed ?? [], version.id)
                    return (
                      <div
                        key={version.id}
                        className={'rh-versionrow rh-stagger' + (selected === version.id ? ' is-selected' : '')}
                        style={{ '--rh-stagger-delay': Math.min(index, 18) * 24 + 'ms' } as React.CSSProperties}
                        onClick={() => setSelected(version.id)}
                      >
                        <span className="rh-versionrow__id">
                          <PluginSlot
                            name="motion.rolling-number"
                            props={{ className: 'rh-versionrow__name', value: versionLabel(version) }}
                            fallback={<span className="rh-versionrow__name">{versionLabel(version)}</span>}
                          />
                          {present ? <Badge tone="ok" mono>{t('versions.installed.badge')}</Badge> : null}
                        </span>
                        <span>
                          <Badge tone={version.type === 'release' ? 'accent' : 'muted'} mono>
                            {version.type}
                          </Badge>
                        </span>
                        <span className="rh-versionrow__date">{formatDate(version.releaseTime)}</span>
                        <span className="rh-versionrow__actions">
                          <Tooltip content={t('versions.action.install')}>
                            <Button size="sm" variant="quiet" onClick={() => startInstall(version.id)}>
                              {present ? t('common.refresh') : t('versions.action.install')}
                            </Button>
                          </Tooltip>
                        </span>
                      </div>
                    )
                  })}
                </div>
              </div>
            )}
          </Panel>
        ) : null}

        {tab === 'installed' ? (
          <Panel padded caption="LOCAL" title={t('versions.tab.installed')}>
            {installedSorted.length === 0 ? (
              <EmptyState
                title={t('versions.installed.empty.title')}
                description={t('versions.installed.empty.desc')}
                action={
                  <Button variant="primary" onClick={() => setTab('remote')}>
                    {t('versions.tab.remote')}
                  </Button>
                }
              />
            ) : (
              <div className="rh-installed">
                {installedSorted.map((id, index) => (
                  <div
                    className="rh-installed__item rh-stagger"
                    style={{ '--rh-stagger-delay': Math.min(index, 18) * 24 + 'ms' } as React.CSSProperties}
                    key={id}
                  >
                    <span>{id}</span>
                    <Badge tone="ok" mono>OK</Badge>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        ) : null}

        {tab === 'loaders' ? (
          <Panel padded caption="LOADERS" title={t('versions.loader.title')}>
            <p className="rh-pagehead__sub" style={{ marginBottom: 14 }}>
              {t('versions.loader.desc')}
            </p>
            <div className="rh-versions__filters">
              <Field label={t('versions.loader.kind')} caption="LOADER" inline className="rh-versions__filter">
                <Select value={loaderKind} onChange={(event) => setLoaderKind(event.target.value as LoaderKind)}>
                  {INSTALL_LOADERS.filter((item) => item.kind !== 'vanilla').map((item) => (
                    <option key={item.kind} value={item.kind}>
                      {item.label}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label={t('versions.loader.gameVersion')} caption="VERSION" inline>
                <Select value={loaderGame} onChange={(event) => setLoaderGame(event.target.value)}>
                  {filterVersions({ versions: remote ?? [], group: 'release', limit: 60 }).map((version) => (
                    <option key={version.id} value={version.id}>
                      {versionLabel(version)}
                    </option>
                  ))}
                </Select>
              </Field>
            </div>

            {loaderLoading ? (
              <Skeleton lines={4} />
            ) : loaderList && loaderList.length > 0 ? (
              <div className="rh-loadergrid">
                {loaderList.map((item, index) => (
                  <div
                    className="rh-loadergrid__item rh-stagger"
                    style={{ '--rh-stagger-delay': Math.min(index, 18) * 24 + 'ms' } as React.CSSProperties}
                    key={item.version}
                  >
                    <PluginSlot
                      name="motion.rolling-number"
                      props={{ className: 'rh-loadergrid__version', value: item.version }}
                      fallback={<span className="rh-loadergrid__version">{item.version}</span>}
                    />
                    <span className="rh-caption">{item.type}</span>
                    <Button
                      size="sm"
                      variant="ghost"
                      leading={<DownloadIcon />}
                      onClick={() => void installLoader(loaderKind, loaderGame, item.version, setTrackedTask, t)}
                    >
                      {t('versions.action.install')}
                    </Button>
                  </div>
                ))}
              </div>
            ) : (
              <EmptyState compact title={t('versions.loader.empty')} />
            )}
          </Panel>
        ) : null}
      </div>

      <InstallVersionDialog
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        t={t}
        target={installTarget}
        versions={remote ? filterVersions({ versions: remote, group: 'all' }).map((item) => item.id) : []}
        onStarted={(taskId) => {
          setTrackedTask(taskId)
          void load()
        }}
      />
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

async function installLoader(
  kind: LoaderKind,
  gameVersion: string,
  loaderVersion: string,
  track: (taskId: string) => void,
  t: ReturnType<typeof useI18n>['t'],
): Promise<void> {
  try {
    const { taskId } = await api.loaders.install(kind, gameVersion, loaderVersion)
    track(taskId)
    toast.show({ level: 'ok', message: t('versions.install.queued') + ': ' + kind + ' ' + loaderVersion })
  } catch (error) {
    toast.show({
      level: 'error',
      message: t('versions.install.failed') + ': ' + (error instanceof Error ? error.message : String(error)),
    })
  }
}

/** Inline progress card for the install task created from this page. */
function TaskProgress({ task }: { task: TaskSnapshot }) {
  const value = task.progress.total > 0 ? task.progress.current / task.progress.total : task.progress.value
  const tone = task.status === 'failed' ? 'danger' : task.status === 'succeeded' ? 'ok' : 'accent'
  return (
    <Panel padded accent caption={'TASK ' + task.kind.toUpperCase()} title={task.title}>
      <Progress
        value={task.status === 'running' || task.status === 'queued' ? value : task.status === 'succeeded' ? 1 : 0}
        label={task.progress.message ?? task.status}
        indeterminate={task.status === 'running' && value < 0}
        tone={tone}
      />
      {task.error ? <p className="rh-field__error">{task.error}</p> : null}
    </Panel>
  )
}