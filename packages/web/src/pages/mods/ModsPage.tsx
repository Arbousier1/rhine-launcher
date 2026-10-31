/**
 * Mods page.
 *
 * Lists everything in `<instance>/mods`, distinguishes enabled from disabled
 * jars, surfaces the ones the backend could not parse (HMCL's "unknown mod"
 * warning) and offers install-from-URL plus install-from-local-path.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import type { ModFile, ModUpdateInfo } from '@rhine/core'
import { api } from '@/api/client'
import {
  Badge, Button, Dialog, EmptyState, Field, IconButton, Input, Panel, Select, Spinner,
  Switch, Tooltip, toast,
} from '@/ui'
import {
  AlertIcon, FolderIcon, PlusIcon, RefreshIcon, SearchIcon, TrashIcon,
} from '@/ui/icons'
import { PageHead } from '@/features/common/PageHead'
import { Notice, Placeholder, StatStrip, Tile } from '@/features/common/toolbar'
import { useCurrentInstance } from '@/features/common/useCurrentInstance'
import { formatBytes, formatRelativeTime } from '@/features/format/index.ts'
import {
  LOADER_LABELS, LOADER_ORDER, displayAuthors, displayGameVersions, displayLoader,
  displayName, displayVersion, isUnreadable, presentLoaders, stripJarSuffix, suggestFileName,
} from '@/features/mods/mods.ts'
import { modBuckets, modStats, useModStore, visibleMods } from '@/stores'
import page from '@/features/common/page.module.css'
import styles from './mods.module.css'

export interface ModsPageProps {
  instanceId?: string
}

export default function ModsPage({ instanceId }: ModsPageProps) {
  const { instances, instance, instanceId: currentId, select } = useCurrentInstance(instanceId)
  const mods = useModStore((state) => state.mods)
  const loading = useModStore((state) => state.loading)
  const error = useModStore((state) => state.error)
  const filter = useModStore((state) => state.filter)
  const sort = useModStore((state) => state.sort)
  const pending = useModStore((state) => state.pending)
  const selected = useModStore((state) => state.selected)
  const load = useModStore((state) => state.load)
  const setFilter = useModStore((state) => state.setFilter)
  const resetFilter = useModStore((state) => state.resetFilter)
  const setSort = useModStore((state) => state.setSort)
  const selectMod = useModStore((state) => state.select)
  const toggle = useModStore((state) => state.toggle)
  const remove = useModStore((state) => state.remove)

  const [installOpen, setInstallOpen] = useState(false)
  const [confirm, setConfirm] = useState<ModFile | null>(null)
  const [checkingUpdates, setCheckingUpdates] = useState(false)
  const [updates, setUpdates] = useState<ModUpdateInfo[]>([])
  const [updateSource, setUpdateSource] = useState<'modrinth'|'curseforge'>('modrinth')
  const [applyingUpdate, setApplyingUpdate] = useState<string | null>(null)

  // Derived lists come from the store so filtering never re-fetches.
  const store = useModStore()
  const visible = useMemo(() => visibleMods(store), [store])
  const buckets = useMemo(() => modBuckets(store), [store])
  const stats = useMemo(() => modStats(store), [store])
  const loaders = useMemo(() => presentLoaders(mods), [mods])
  const selectedMod = useMemo(
    () => mods.find((mod) => mod.diskName === selected) ?? null,
    [mods, selected],
  )

  useEffect(() => {
    if (currentId) void load(currentId)
  }, [currentId, load])

  const openModFolder = useCallback(async () => {
    if (!instance) return
    try {
      await api.system.reveal(instance.path + '/mods')
    } catch (cause) {
      toast.show({ level: 'error', message: '无法打开目录：' + message(cause) })
    }
  }, [instance])

  const onCheckUpdates = useCallback(async () => {
    if (!currentId) return
    setCheckingUpdates(true)
    try {
      const list = await api.instances.checkModUpdates(currentId,updateSource)
      setUpdates(list)
      const available=list.filter(row=>row.status==='update').length
      const failed=list.filter(row=>row.status==='error').length
      const unknown=list.filter(row=>row.status==='unknown').length
      toast.show({level:failed?'warn':'info',message:available+' 个可更新，'+unknown+' 个未识别，'+failed+' 个检查失败'})
    } catch (err: any) {
      toast.show({ level: 'error', message: '检查更新失败：' + (err.message || String(err)) })
    } finally {
      setCheckingUpdates(false)
    }
  }, [currentId,updateSource])

  const onApplyUpdate=useCallback(async(update:ModUpdateInfo)=>{
    if(!currentId||!update.updateId)return
    setApplyingUpdate(update.updateId)
    try{
      await api.instances.applyModUpdate(currentId,update.updateId,update.diskName)
      toast.show({level:'info',message:'已提交更新任务；校验成功后原子替换旧文件，进度见日志页'})
      setUpdates(items=>items.filter(item=>item.updateId!==update.updateId))
    }catch(error){toast.show({level:'error',message:message(error)})}
    finally{setApplyingUpdate(null)}
  },[currentId])

  const onToggle = useCallback(
    async (mod: ModFile) => {
      if (!currentId) return
      try {
        await toggle(currentId, mod)
      } catch (cause) {
        toast.show({ level: 'error', message: '切换失败：' + message(cause) })
      }
    },
    [currentId, toggle],
  )

  const onDelete = useCallback(async () => {
    if (!currentId || !confirm) return
    const target = confirm
    setConfirm(null)
    try {
      await remove(currentId, target.diskName)
      toast.show({ level: 'ok', message: '已删除 ' + displayName(target) })
    } catch (cause) {
      toast.show({ level: 'error', message: '删除失败：' + message(cause) })
    }
  }, [confirm, currentId, remove])

  const refresh = useCallback(() => {
    if (currentId) void load(currentId, true)
  }, [currentId, load])

  if (instances.length === 0) {
    return (
      <div className={page.stack}>
        <PageHead caption="MODS" title="模组" description="管理实例 mods 目录下的模组文件" />
        <Panel>
          <EmptyState
            title="还没有任何实例"
            description="先在「档案」里创建一个实例，才能管理它的模组。"
            caption="NO INSTANCE"
          />
        </Panel>
      </div>
    )
  }

  return (
    <div className={page.stack}>
      <PageHead
        caption="MODS"
        title="模组"
        description={
          instance
            ? instance.name + ' · ' + instance.gameVersion + ' · ' + mods.length + ' 个文件'
            : '管理实例 mods 目录下的模组文件'
        }
        actions={
          <>
            {instances.length > 1 ? (
              <Select
                aria-label="选择实例"
                value={currentId ?? ''}
                onChange={(event) => select(event.target.value)}
              >
                {instances.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name} · {item.gameVersion}
                  </option>
                ))}
              </Select>
            ) : null}
            <Tooltip content="打开 mods 目录">
              <IconButton label="打开 mods 目录" onClick={() => void openModFolder()}>
                <FolderIcon />
              </IconButton>
            </Tooltip>
            <Select aria-label="更新来源" value={updateSource} onChange={event=>setUpdateSource(event.target.value as 'modrinth'|'curseforge')}>
              <option value="modrinth">Modrinth 更新</option><option value="curseforge">CurseForge 更新</option>
            </Select>
            <Button
              variant="ghost"
              onClick={() => void onCheckUpdates()}
              disabled={checkingUpdates || !currentId}
            >
              {checkingUpdates ? <Spinner size="sm" /> : '检查更新'}
            </Button>
            <IconButton label="刷新" onClick={refresh} disabled={loading}>
              <RefreshIcon />
            </IconButton>
            <Button
              variant="primary"
              leading={<PlusIcon />}
              onClick={() => setInstallOpen(true)}
              disabled={!currentId}
            >
              安装模组
            </Button>
          </>
        }
        toolbar={
          <div className={styles.filterRow}>
            <Input
              className={page.search}
              placeholder="按名称、ID 或文件名搜索"
              aria-label="搜索模组"
              leading={<SearchIcon />}
              value={filter.query}
              onChange={(event) => setFilter({ query: event.target.value })}
            />
            <Segmented
              label="状态"
              value={filter.state}
              options={[
                { key: 'all', label: '全部', count: stats.total },
                { key: 'enabled', label: '已启用', count: stats.enabled },
                { key: 'disabled', label: '已禁用', count: stats.disabled },
              ]}
              onChange={(key) => setFilter({ state: key as typeof filter.state })}
            />
            <Segmented
              label="健康"
              value={filter.health}
              options={[
                { key: 'all', label: '全部' },
                { key: 'ok', label: '可解析' },
                { key: 'broken', label: '解析失败', count: stats.broken },
              ]}
              onChange={(key) => setFilter({ health: key as typeof filter.health })}
            />
            <Select
              aria-label="按加载器筛选"
              value={filter.loader}
              onChange={(event) => setFilter({ loader: event.target.value as typeof filter.loader })}
            >
              <option value="all">全部加载器</option>
              {LOADER_ORDER.map((kind) => (
                <option key={kind} value={kind} disabled={!loaders.includes(kind)}>
                  {LOADER_LABELS[kind]}
                </option>
              ))}
            </Select>
            <Select
              aria-label="排序"
              value={sort}
              onChange={(event) => setSort(event.target.value as typeof sort)}
            >
              <option value="name">按名称</option>
              <option value="updated">按修改时间</option>
              <option value="size">按大小</option>
            </Select>
            {hasFilters(filter) ? (
              <Button variant="quiet" size="sm" onClick={resetFilter}>清除筛选</Button>
            ) : null}
          </div>
        }
      />

      {updates.length>0 && <Panel caption="UPDATE REPORT" title="逐文件更新结果">
        {updates.map(row=><div key={row.source+row.diskName} style={{display:'flex',gap:12,alignItems:'center',padding:'10px 0',borderBottom:'1px solid var(--rhine-line)'}}>
          <span style={{flex:1}}>{row.diskName}<small style={{display:'block',color:'var(--rhine-muted)'}}>{row.status==='update'?(row.currentVersion??'?')+' → '+row.latestVersion:row.status==='current'?'已是最新兼容版本':row.status==='unknown'?'来源未识别，不能判断更新':row.error?.message??'检查失败'}</small></span>
          {row.status==='update'&&row.updateId&&<Button variant="primary" disabled={applyingUpdate!==null} onClick={()=>void onApplyUpdate(row)}>应用更新</Button>}
        </div>)}
      </Panel>}

      <StatStrip
        items={[
          { caption: 'TOTAL', value: stats.total, hint: '文件总数' },
          { caption: 'ENABLED', value: stats.enabled, hint: '已启用' },
          { caption: 'DISABLED', value: stats.disabled, hint: '已禁用' },
          { caption: 'UNREADABLE', value: stats.broken, hint: '解析失败' },
          { caption: 'SIZE', value: formatBytes(stats.bytes), hint: '占用空间' },
        ]}
      />

      {error ? <Notice level="danger" title="加载失败">{error}</Notice> : null}

      <div className={page.columns}>
        <Panel
          caption="FILES"
          title="模组文件"
          actions={<span className={clsx(page.dim, page.tiny)}>{visible.length} 个匹配</span>}
        >
          {loading && mods.length === 0 ? (
            <div className={page.placeholder}><Spinner label="正在读取 mods 目录" /></div>
          ) : mods.length === 0 ? (
            <EmptyState
              title="mods 目录是空的"
              description="从市场安装模组，或把 jar 文件放进实例的 mods 目录。"
              caption="EMPTY"
              compact
            />
          ) : visible.length === 0 ? (
            <EmptyState
              title="没有符合条件的模组"
              description="调整搜索词或筛选条件再试。"
              caption="NO MATCH"
              compact
            />
          ) : (
            <div className={styles.list}>
              {visible.map((mod) => (
                <ModRow
                  key={mod.diskName}
                  mod={mod}
                  busy={pending[mod.diskName] === true}
                  selected={selected === mod.diskName}
                  onSelect={() => selectMod(selected === mod.diskName ? null : mod.diskName)}
                  onToggle={() => void onToggle(mod)}
                  onDelete={() => setConfirm(mod)}
                />
              ))}
            </div>
          )}
        </Panel>

        <div className={page.side}>
          {buckets.broken.length > 0 ? (
            <Panel
              caption="UNREADABLE"
              title="解析失败的文件"
              actions={<Badge tone="warn">{buckets.broken.length}</Badge>}
            >
              <p className={clsx(page.dim, page.tiny)}>
                这些 jar 没有可识别的 fabric.mod.json / mods.toml / mcmod.info，
                可能是加载器不匹配或文件损坏，它们通常会让游戏直接崩溃。
              </p>
              <div className={styles.brokenList}>
                {buckets.broken.map((mod) => (
                  <div className={styles.brokenItem} key={mod.diskName}>
                    <span className={page.monoText}>{mod.diskName}</span>
                    <span className={page.nowrap}>{formatBytes(mod.size)}</span>
                  </div>
                ))}
              </div>
            </Panel>
          ) : null}

          <Panel caption="DETAIL" title={selectedMod ? '模组详情' : '选择一个模组'}>
            {selectedMod ? (
              <ModDetail
                mod={selectedMod}
                onToggle={() => void onToggle(selectedMod)}
                busy={pending[selectedMod.diskName] === true}
              />
            ) : (
              <Placeholder>点击左侧任意一行查看解析结果。</Placeholder>
            )}
          </Panel>
        </div>
      </div>

      <InstallDialog
        open={installOpen}
        onClose={() => setInstallOpen(false)}
        instanceId={currentId}
        onDone={refresh}
      />

      <Dialog
        open={confirm !== null}
        onClose={() => setConfirm(null)}
        caption="DELETE"
        title="删除模组文件"
        width={460}
        footer={
          <>
            <Button variant="quiet" onClick={() => setConfirm(null)}>取消</Button>
            <Button variant="danger" onClick={() => void onDelete()}>删除</Button>
          </>
        }
      >
        <p>
          将从磁盘删除 <span className={page.monoText}>{confirm?.diskName}</span>。
          该操作不可撤销，存档中依赖它的物品可能丢失。
        </p>
      </Dialog>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* row                                                                 */
/* ------------------------------------------------------------------ */

function ModRow({ mod, busy, selected, onSelect, onToggle, onDelete }: {
  mod: ModFile
  busy: boolean
  selected: boolean
  onSelect: () => void
  onToggle: () => void
  onDelete: () => void
}) {
  const broken = isUnreadable(mod)
  return (
    <div
      className={clsx(
        page.row,
        styles.row,
        selected && clsx(styles.selected, page['is-active']),
        !mod.enabled && page['is-muted'],
      )}
      onClick={onSelect}
      role="button"
      tabIndex={0}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onSelect()
        }
      }}
    >
      <Tile src={mod.meta?.icon} label={broken ? <AlertIcon /> : stripJarSuffix(mod.name).slice(0, 2)} />
      <div className={page.row__main}>
        <span className={broken ? clsx(styles.name, styles['name--muted']) : styles.name}>
          {displayName(mod)}
        </span>
        <span className={styles.meta}>
          {broken ? (
            <Badge tone="warn">解析失败</Badge>
          ) : (
            <>
              <Badge tone="muted" mono>{displayLoader(mod)}</Badge>
              <span className="rh-num">{displayVersion(mod)}</span>
            </>
          )}
          <span>{formatBytes(mod.size)}</span>
          <span>{formatRelativeTime(mod.modifiedAt)}</span>
          {mod.enabled ? null : <Badge tone="muted">已禁用</Badge>}
        </span>
      </div>
      <div className={page.row__actions} onClick={(event) => event.stopPropagation()}>
        {busy ? <Spinner size="sm" /> : (
          <Switch checked={mod.enabled} onCheckedChange={onToggle} disabled={busy} />
        )}
        <Tooltip content="删除">
          <IconButton label={'删除 ' + displayName(mod)} variant="ghost" size="sm" onClick={onDelete}>
            <TrashIcon />
          </IconButton>
        </Tooltip>
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* detail                                                              */
/* ------------------------------------------------------------------ */

function ModDetail({ mod, onToggle, busy }: { mod: ModFile; onToggle: () => void; busy: boolean }) {
  const meta = mod.meta
  const broken = isUnreadable(mod)
  return (
    <div className={styles.detail}>
      <div className={styles.detail__head}>
        <Tile src={meta?.icon} label={broken ? <AlertIcon /> : stripJarSuffix(mod.name).slice(0, 2)} size="lg" />
        <div className={styles.nameCell}>
          <span className={styles.detail__title}>{displayName(mod)}</span>
          <span className={styles.meta}>
            {broken ? <Badge tone="warn">无法解析描述文件</Badge> : (
              <>
                <Badge tone="accent" mono>{displayLoader(mod)}</Badge>
                <span className="rh-num">{displayVersion(mod)}</span>
              </>
            )}
          </span>
        </div>
      </div>

      {meta?.description ? <p className={styles.detail__desc}>{meta.description}</p> : null}

      <dl className={styles.kv}>
        <dt>文件</dt>
        <dd className="rh-mono">{mod.diskName}</dd>
        <dt>大小</dt>
        <dd>{formatBytes(mod.size)}</dd>
        <dt>修改时间</dt>
        <dd>{formatRelativeTime(mod.modifiedAt)}</dd>
        {meta?.id ? (<><dt>Mod ID</dt><dd className="rh-mono">{meta.id}</dd></>) : null}
        {meta ? (<><dt>作者</dt><dd>{displayAuthors(meta)}</dd></>) : null}
        {meta ? (<><dt>适用版本</dt><dd>{displayGameVersions(meta, 4)}</dd></>) : null}
        <dt>状态</dt>
        <dd>{mod.enabled ? '已启用' : '已禁用'}</dd>
      </dl>

      {meta?.dependencies?.length ? (
        <div>
          <span className="rh-caption">DEPENDENCIES</span>
          <div className={styles.tagRow}>
            {meta.dependencies.map((dep, index) => (
              <Badge key={dep.id + index} tone={dep.optional ? 'muted' : 'warn'} mono>
                {dep.id}{dep.versionRange ? ' ' + dep.versionRange : ''}
              </Badge>
            ))}
          </div>
        </div>
      ) : null}

      <Button variant={mod.enabled ? 'ghost' : 'primary'} block loading={busy} onClick={onToggle}>
        {mod.enabled ? '禁用该模组' : '启用该模组'}
      </Button>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* install dialog                                                      */
/* ------------------------------------------------------------------ */

function InstallDialog({ open, onClose, instanceId, onDone }: {
  open: boolean
  onClose: () => void
  instanceId: string | undefined
  onDone: () => void
}) {
  const [mode, setMode] = useState<'url' | 'path'>('path')
  const [url, setUrl] = useState('')
  const [fileName, setFileName] = useState('')
  const [path, setPath] = useState('')
  const [busy, setBusy] = useState(false)
  const fileTouched = useRef(false)

  useEffect(() => {
    if (!open) return
    setUrl('')
    setPath('')
    setFileName('')
    fileTouched.current = false
    setBusy(false)
  }, [open])

  // Keep the suggested file name in sync with the URL until the user edits it.
  useEffect(() => {
    if (!fileTouched.current && url.trim()) setFileName(suggestFileName(url))
  }, [url])

  const submitUrl = async () => {
    if (!instanceId) return
    const trimmed = url.trim()
    if (!/^https?:\/\//i.test(trimmed)) {
      toast.show({ level: 'warn', message: '请填写 http(s) 开头的下载地址' })
      return
    }
    setBusy(true)
    try {
      const { taskId } = await api.instances.installMod(
        instanceId,
        trimmed,
        fileName.trim() || suggestFileName(trimmed),
      )
      toast.show({ level: 'ok', message: '已开始下载安装（任务 ' + taskId.slice(0, 6) + '），进度见「日志」页' })
      onClose()
      window.setTimeout(onDone, 1200)
    } catch (cause) {
      toast.show({ level: 'error', message: '安装失败：' + message(cause) })
    } finally {
      setBusy(false)
    }
  }

  const submitPath = async () => {
    if (!instanceId) return
    const trimmed = path.trim().replace(/^"|"$/g, '')
    if (!trimmed) {
      toast.show({ level: 'warn', message: '请粘贴 jar 文件的绝对路径' })
      return
    }
    setBusy(true)
    try {
      const mod = await api.instances.importMod(instanceId, trimmed)
      toast.show({ level: 'ok', message: '已导入 ' + (mod.meta?.name || mod.diskName) })
      onClose()
      onDone()
    } catch (cause) {
      toast.show({ level: 'error', message: '导入失败：' + message(cause) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      caption="INSTALL"
      title="安装模组"
      width={560}
      footer={
        <>
          <Button variant="quiet" onClick={onClose}>取消</Button>
          <Button
            variant="primary"
            loading={busy}
            onClick={() => void (mode === 'url' ? submitUrl() : submitPath())}
          >
            开始安装
          </Button>
        </>
      }
    >
      <div className={styles.dialogStack}>
        <div className={page.inlineField}>
          <Button variant={mode === 'path' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('path')}>
            本地文件
          </Button>
          <Button variant={mode === 'url' ? 'primary' : 'ghost'} size="sm" onClick={() => setMode('url')}>
            下载地址
          </Button>
        </div>

        {mode === 'path' ? (
          <Field
            label="jar 绝对路径"
            hint="把 jar 拖到输入框或粘贴完整路径，例如 C:\\Users\\me\\Downloads\\sodium.jar"
          >
            <Input
              autoFocus
              mono
              value={path}
              placeholder="C:\\Users\\me\\Downloads\\mod.jar"
              onChange={(event) => setPath(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') void submitPath()
              }}
            />
          </Field>
        ) : (
          <>
            <Field label="下载地址">
              <Input
                autoFocus
                mono
                value={url}
                placeholder="https://example.com/mod.jar"
                onChange={(event) => setUrl(event.target.value)}
              />
            </Field>
            <Field label="保存文件名" hint="默认取地址中的文件名；重名会被自动重命名。">
              <Input
                value={fileName}
                onChange={(event) => {
                  fileTouched.current = true
                  setFileName(event.target.value)
                }}
              />
            </Field>
          </>
        )}

        <Notice level="info" title="提示">
          安装完成后需要回到游戏启动前启用模组；Fabric / Quilt 模组通常还需要 Fabric API 前置。
        </Notice>
      </div>
    </Dialog>
  )
}

/* ------------------------------------------------------------------ */
/* helpers                                                             */
/* ------------------------------------------------------------------ */

function Segmented({ label, value, options, onChange }: {
  label: string
  value: string
  options: { key: string; label: string; count?: number }[]
  onChange: (key: string) => void
}) {
  return (
    <div className={page.toolbarGroup}>
      <span className={page.toolbarLabel}>{label}</span>
      <span className={page.segmented}>
        {options.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={option.key === value}
            className={clsx(page.segmented__item, option.key === value && page['is-active'])}
            onClick={() => onChange(option.key)}
          >
            {option.label}
            {typeof option.count === 'number' ? <span className="rh-num"> {option.count}</span> : null}
          </button>
        ))}
      </span>
    </div>
  )
}

function hasFilters(filter: { query: string; state: string; health: string; loader: string }): boolean {
  return Boolean(filter.query) || filter.state !== 'all' || filter.health !== 'all' || filter.loader !== 'all'
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}