/**
 * Market page: Modrinth + CurseForge in one browser.
 *
 * Left column is the result grid (downloads shown per HMCL's popularity line),
 * right column is the detail drawer that lists compatible versions and installs
 * them into the selected instance. The instance's game version and loader seed
 * the filters so the first search is already relevant.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { MarketProject, MarketVersion, ProjectType } from '@rhine/core'
import {
  Badge, Button, Dialog, EmptyState, IconButton, Input, Panel, Select, Skeleton,
  Spinner, Tabs, toast,
} from '@/ui'
import { DownloadIcon, RefreshIcon, SearchIcon } from '@/ui/icons'
import { PageHead } from '@/features/common/PageHead'
import { Notice, Placeholder } from '@/features/common/toolbar'
import { useCurrentInstance } from '@/features/common/useCurrentInstance'
import { formatCount, formatRelativeTime } from '@/features/format/index.ts'
import {
  MARKET_SOURCES, PROJECT_TYPES, SORT_OPTIONS, clampPage, compatibleVersions,
  dependencyMessage, loaderOptions, pageCount, projectKey, projectMetaLine, queryFromInstance,
  releaseLabel, releaseTone, summarizeDependencies, targetSubdir,
} from '@/features/market/market.ts'
import { useMarketStore } from '@/stores'
import page from '@/features/common/page.module.css'
import styles from './market.module.css'

export interface MarketPageProps {
  instanceId?: string
}

export default function MarketPage({ instanceId }: MarketPageProps) {
  const { instances, instance, instanceId: currentId, select } = useCurrentInstance(instanceId)

  const query = useMarketStore((state) => state.query)
  const result = useMarketStore((state) => state.result)
  const loading = useMarketStore((state) => state.loading)
  const error = useMarketStore((state) => state.error)
  const activeProject = useMarketStore((state) => state.activeProject)
  const versions = useMarketStore((state) => state.versions)
  const versionsLoading = useMarketStore((state) => state.versionsLoading)
  const versionsError = useMarketStore((state) => state.versionsError)
  const installing = useMarketStore((state) => state.installing)
  const setSource = useMarketStore((state) => state.setSource)
  const patchQuery = useMarketStore((state) => state.patchQuery)
  const setPage = useMarketStore((state) => state.setPage)
  const setSort = useMarketStore((state) => state.setSort)
  const search = useMarketStore((state) => state.search)
  const openProject = useMarketStore((state) => state.openProject)
  const closeProject = useMarketStore((state) => state.closeProject)
  const install = useMarketStore((state) => state.install)

  const [draft, setDraft] = useState(query.query)
  const [installTarget, setInstallTarget] = useState<MarketVersion | null>(null)

  // Seed the filters from the selected instance exactly once per instance id.
  // Depending on the instance object would reset the user's filters on every
  // server event (each event produces a new object identity).
  const seedRef = useRef<string | null>(null)
  useEffect(() => {
    if (!currentId || seedRef.current === currentId) return
    seedRef.current = currentId
    const current = useMarketStore.getState().query
    const seeded = queryFromInstance(instance, current)
    useMarketStore.setState({ query: seeded })
    void useMarketStore.getState().search()
  }, [currentId, instance])

  const pages = pageCount(result?.total ?? 0, query.pageSize)
  const hits = result?.hits ?? []
  const filteredVersions = useMemo(
    () => compatibleVersions(versions, { gameVersion: query.gameVersion, loader: query.loader }),
    [versions, query.gameVersion, query.loader],
  )
  const showAllVersions = filteredVersions.length === 0 && versions.length > 0
  const visibleVersions = showAllVersions ? versions : filteredVersions

  const submitSearch = useCallback(() => {
    patchQuery({ query: draft })
    void search({ query: draft, page: 0 })
  }, [draft, patchQuery, search])

  const onInstall = useCallback(
    async (version: MarketVersion) => {
      if (!currentId) {
        toast.show({ level: 'warn', message: '先选择一个实例，才能安装到这个实例' })
        return
      }
      setInstallTarget(null)
      try {
        const taskId = await install(currentId, version)
        toast.show({
          level: 'ok',
          message: '已开始安装 ' + version.versionNumber + '（任务 ' + taskId.slice(0, 6) + '）',
        })
      } catch (cause) {
        toast.show({ level: 'error', message: '安装失败：' + message(cause) })
      }
    },
    [currentId, install],
  )

  const openDetail = useCallback(
    (project: MarketProject) => {
      void openProject(project)
    },
    [openProject],
  )

  return (
    <div className={page.stack}>
      <PageHead
        caption="MARKET"
        title="模组市场"
        description={
          instance
            ? '为 ' + instance.name + ' 寻找内容 · ' + instance.gameVersion
            : '从 Modrinth 与 CurseForge 搜索并安装内容'
        }
        actions={
          <>
            {instances.length > 1 ? (
              <Select
                aria-label="目标实例"
                value={currentId ?? ''}
                onChange={(event) => select(event.target.value)}
              >
                {instances.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} · {item.gameVersion}</option>
                ))}
              </Select>
            ) : null}
            <IconButton label="刷新结果" onClick={() => void search()} disabled={loading}>
              <RefreshIcon />
            </IconButton>
          </>
        }
        toolbar={
          <div className={styles.filterBar}>
            <div className={styles.sourceSwitch} role="tablist" aria-label="内容来源">
              {MARKET_SOURCES.map((source) => (
                <button
                  key={source.key}
                  type="button"
                  role="tab"
                  aria-selected={query.source === source.key}
                  className={clsx(styles.source, query.source === source.key && styles['is-active'])}
                  onClick={() => {
                    setSource(source.key)
                    void search({ source: source.key, page: 0 })
                  }}
                >
                  <span className={styles.source__name}>{source.label}</span>
                  <span className={styles.source__caption}>{source.caption}</span>
                </button>
              ))}
            </div>

            <Input
              className={page.search}
              value={draft}
              placeholder="搜索模组、整合包、资源包…"
              aria-label="搜索内容"
              leading={<SearchIcon />}
              onChange={(event) => setDraft(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') submitSearch()
              }}
            />
            <Button variant="ghost" onClick={submitSearch} loading={loading}>搜索</Button>

            <Select
              aria-label="内容类型"
              value={query.projectType}
              onChange={(event) => {
                const projectType = event.target.value as ProjectType
                const loaders = loaderOptions(projectType)
                const loader = loaders.length ? query.loader : ''
                patchQuery({ projectType, loader })
                void search({ projectType, loader, page: 0 })
              }}
            >
              {PROJECT_TYPES.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </Select>

            {loaderOptions(query.projectType).length > 0 ? (
              <Select
                aria-label="加载器"
                value={query.loader}
                onChange={(event) => {
                  patchQuery({ loader: event.target.value })
                  void search({ loader: event.target.value, page: 0 })
                }}
              >
                <option value="">全部加载器</option>
                {loaderOptions(query.projectType).map((item) => (
                  <option key={item.key} value={item.key}>{item.label}</option>
                ))}
              </Select>
            ) : null}

            <Select
              aria-label="游戏版本"
              value={query.gameVersion}
              onChange={(event) => {
                patchQuery({ gameVersion: event.target.value })
                void search({ gameVersion: event.target.value, page: 0 })
              }}
            >
              <option value="">全部版本</option>
              {gameVersionChoices(instance?.gameVersion).map((version) => (
                <option key={version} value={version}>{version}</option>
              ))}
            </Select>

            <Select
              aria-label="排序"
              value={query.sort}
              onChange={(event) => {
                setSort(event.target.value as typeof query.sort)
                void search({ sort: event.target.value as typeof query.sort, page: 0 })
              }}
            >
              {SORT_OPTIONS.map((item) => (
                <option key={item.key} value={item.key}>{item.label}</option>
              ))}
            </Select>
          </div>
        }
      />

      {error ? (
        <Notice level="danger" title="搜索失败" actions={<Button size="sm" onClick={() => void search()}>重试</Button>}>
          {error}
        </Notice>
      ) : null}

      <div className={page.columns}>
        <Panel
          caption={query.source === 'modrinth' ? 'MODRINTH' : 'CURSEFORGE'}
          title="搜索结果"
          actions={
            <span className={clsx(page.dim, page.tiny)}>
              {result ? '共 ' + formatCount(result.total) + ' 条' : '尚未搜索'}
            </span>
          }
        >
          {loading && hits.length === 0 ? (
            <div className={styles.grid}>
              {Array.from({ length: 6 }, (_, index) => (
                <Skeleton key={index} height={148} />
              ))}
            </div>
          ) : hits.length === 0 ? (
            <EmptyState
              title="没有找到匹配的内容"
              description="换个关键词，或放宽游戏版本 / 加载器筛选。"
              caption="NO RESULT"
              compact
            />
          ) : (
            <div className={styles.grid}>
              {hits.map((project) => (
                <ProjectCard
                  key={projectKey(project)}
                  project={project}
                  active={activeProject !== null && projectKey(activeProject) === projectKey(project)}
                  onOpen={() => openDetail(project)}
                />
              ))}
            </div>
          )}

          <div className={styles.pager}>
            <span className={styles.pager__info}>
              第 {clampPage(query.page, result?.total ?? 0, query.pageSize) + 1} / {pages} 页
              {result ? ' · ' + result.hits.length + ' 条本页' : ''}
            </span>
            <div className={styles.pager__buttons}>
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || query.page <= 0}
                onClick={() => {
                  const next = query.page - 1
                  setPage(next)
                  void search({ page: next })
                }}
              >
                上一页
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={loading || query.page >= pages - 1}
                onClick={() => {
                  const next = query.page + 1
                  setPage(next)
                  void search({ page: next })
                }}
              >
                下一页
              </Button>
            </div>
          </div>
        </Panel>

        <div className={page.side}>
          <Panel
            caption="DETAIL"
            title={activeProject ? activeProject.title : '选择一个项目'}
            actions={activeProject ? (
              <Button size="sm" variant="quiet" onClick={closeProject}>
                关闭
              </Button>
            ) : undefined}
          >
            {activeProject ? (
              <ProjectDetail
                project={activeProject}
                versions={visibleVersions}
                loading={versionsLoading}
                error={versionsError}
                fallbackNotice={showAllVersions}
                installing={installing}
                instanceName={instance?.name}
                onInstall={(version) => setInstallTarget(version)}
              />
            ) : (
              <Placeholder>从左侧选择一个项目，查看可用版本并安装。</Placeholder>
            )}
          </Panel>
        </div>
      </div>

      <Dialog
        open={installTarget !== null}
        onClose={() => setInstallTarget(null)}
        caption="INSTALL"
        title="确认安装"
        width={480}
        footer={
          <>
            <Button variant="quiet" onClick={() => setInstallTarget(null)}>取消</Button>
            <Button variant="primary" onClick={() => installTarget && void onInstall(installTarget)}>
              安装到 {instance?.name ?? '当前实例'}
            </Button>
          </>
        }
      >
        {installTarget ? (
          <div className={styles.drawer}>
            <dl className={page.formRow__control}>
              <dt className="rh-caption">版本</dt>
              <dd>{installTarget.name} · {installTarget.versionNumber}</dd>
              <dt className="rh-caption">目标目录</dt>
              <dd className="rh-mono">{targetSubdir(activeProject?.projectType ?? 'mod')}/</dd>
              <dt className="rh-caption">文件</dt>
              <dd className="rh-mono">{installTarget.file.fileName}</dd>
            </dl>
            {summarizeDependencies(installTarget).warn ? (
              <Notice level="warn" title="依赖提示">{dependencyMessage(installTarget)}</Notice>
            ) : null}
          </div>
        ) : null}
      </Dialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* card                                                                */
/* ------------------------------------------------------------------ */

function ProjectCard({ project, active, onOpen }: {
  project: MarketProject
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      className={clsx(styles.card, active && styles['is-active'])}
      onClick={onOpen}
    >
      <div className={styles.card__head}>
        {project.iconUrl ? (
          <img
            className={styles.card__icon}
            src={project.iconUrl}
            alt=""
            loading="lazy"
            referrerPolicy="no-referrer"
          />
        ) : (
          <span className={styles.card__iconFallback}>{project.title.slice(0, 2)}</span>
        )}
        <div className={page.grow}>
          <div className={styles.card__title}>{project.title}</div>
          <div className={styles.card__author}>
            {project.author ?? project.slug} · {projectMetaLine(project)}
          </div>
        </div>
      </div>
      <p className={styles.card__desc}>{project.description || '暂无简介'}</p>
      <div className={styles.card__tags}>
        {project.categories.slice(0, 3).map((category) => (
          <Badge key={category} tone="muted">{category}</Badge>
        ))}
      </div>
      <div className={styles.card__foot}>
        <span className={styles.card__downloads}>
          <DownloadIcon width={12} height={12} />
          {formatCount(project.downloads)}
        </span>
        <span>{formatRelativeTime(project.updatedAt)}</span>
      </div>
    </button>
  )
}

/* ------------------------------------------------------------------ */
/* detail                                                              */
/* ------------------------------------------------------------------ */

function ProjectDetail({ project, versions, loading, error, fallbackNotice, installing, instanceName, onInstall }: {
  project: MarketProject
  versions: MarketVersion[]
  loading: boolean
  error: string | null
  fallbackNotice: boolean
  installing: Record<string, string>
  instanceName: string | undefined
  onInstall: (version: MarketVersion) => void
}) {
  const [tab, setTab] = useState('versions')

  return (
    <div className={styles.drawer}>
      <div>
        <p className={styles.drawer__desc}>{project.description || '暂无简介'}</p>
      </div>

      <dl className={styles.card__foot + ' ' + page.formRow__control}>
        <div className={styles.version__meta}>
          <span>下载 {formatCount(project.downloads)}</span>
          {typeof project.follows === 'number' ? <span>关注 {formatCount(project.follows)}</span> : null}
          <span>更新 {formatRelativeTime(project.updatedAt)}</span>
        </div>
      </dl>

      <Tabs
        ariaLabel="项目信息"
        value={tab}
        onChange={setTab}
        items={[
          { key: 'versions', label: '版本', count: versions.length },
          { key: 'meta', label: '信息' },
        ]}
      />

      {tab === 'meta' ? (
        <div className={page.formRow__control}>
          <span className="rh-caption">LOADERS</span>
          <div className={styles.version__meta}>
            {project.loaders.length ? project.loaders.map((loader) => (
              <Badge key={loader} tone="muted" mono>{loader}</Badge>
            )) : <span>不区分加载器</span>}
          </div>
          <span className="rh-caption">GAME VERSIONS</span>
          <div className={styles.card__tags}>
            {project.gameVersions.slice(0, 12).map((version) => (
              <Badge key={version} tone="muted" mono>{version}</Badge>
            ))}
            {project.gameVersions.length > 12 ? (
              <Badge tone="muted">+{project.gameVersions.length - 12}</Badge>
            ) : null}
          </div>
          <span className="rh-caption">CATEGORIES</span>
          <div className={styles.card__tags}>
            {project.categories.map((category) => (
              <Badge key={category} tone="accent">{category}</Badge>
            ))}
          </div>
        </div>
      ) : error ? (
        <Notice level="danger" title="无法获取版本">{error}</Notice>
      ) : loading ? (
        <div className={page.placeholder}><Spinner label="正在获取版本列表" /></div>
      ) : versions.length === 0 ? (
        <EmptyState
          title="没有可用版本"
          description="该项目可能尚未发布文件，或已被作者删除。"
          caption="NO FILES"
          compact
        />
      ) : (
        <>
          {fallbackNotice ? (
            <Notice level="warn" title="筛选过窄">
              当前游戏版本 / 加载器没有匹配的版本，下面显示的是全部版本。
            </Notice>
          ) : null}
          <div className={styles.versionList}>
            {versions.map((version) => {
              const phase = installing[version.id]
              const deps = summarizeDependencies(version)
              return (
                <div className={styles.version} key={version.id}>
                  <div className={styles.version__head}>
                    <Badge tone={releaseTone(version.releaseType)}>{releaseLabel(version.releaseType)}</Badge>
                    <span className={styles.version__name}>{version.name || version.versionNumber}</span>
                  </div>
                  <div className={styles.version__meta}>
                    <span className="rh-num">{version.versionNumber}</span>
                    {version.loaders.length ? <span>{version.loaders.join(' / ')}</span> : null}
                    {version.gameVersions.length ? <span>{version.gameVersions.slice(0, 2).join(' / ')}</span> : null}
                    <span>{formatRelativeTime(version.publishedAt)}</span>
                  </div>
                  <div className={styles.version__foot}>
                    <span className={styles.version__meta}>
                      <DownloadIcon width={12} height={12} />
                      {formatCount(version.downloads)}
                      {deps.required > 0 ? <Badge tone="warn">需 {deps.required} 个前置</Badge> : null}
                    </span>
                    <Button
                      size="sm"
                      variant={phase === 'done' ? 'quiet' : 'primary'}
                      loading={phase === 'installing'}
                      disabled={!instanceName || phase === 'done'}
                      onClick={() => onInstall(version)}
                    >
                      {phase === 'done' ? '已安装' : instanceName ? '安装' : '先选实例'}
                    </Button>
                  </div>
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

/**
 * Game version choices for the filter.
 *
 * The full Mojang list is huge, so this offers the instance's version first,
 * then a handful of nearby releases; the free-form value can still be typed
 * by picking from the search results' versions.
 */
function gameVersionChoices(instanceVersion: string | undefined): string[] {
  const known = ['1.21.4', '1.21.1', '1.20.6', '1.20.4', '1.20.1', '1.19.2', '1.18.2', '1.16.5', '1.12.2', '1.8.9']
  const set = new Set<string>()
  if (instanceVersion) set.add(instanceVersion)
  for (const version of known) set.add(version)
  return [...set]
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
