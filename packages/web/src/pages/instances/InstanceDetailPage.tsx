/**
 * Instance detail page: overview / mods / logs / settings.
 *
 * Defensive by design: the instance may disappear (deleted elsewhere), the mod
 * list may 404, and diagnostics may be missing on an older backend. Each of
 * those degrades into a panel-level notice instead of a crash.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import type { Instance, InstanceFile, LogLine, ModFile } from '@rhine/core'
import { api } from '@/api/client'
import {
  Badge, Button, Dialog, EmptyState, Field, Input, Panel, PanelRow, PanelRows, Skeleton,
  Spinner, StatGrid, Tabs, Textarea, toast,
} from '@/ui'
import {
  AlertIcon, ArrowLeftIcon, CopyIcon, FolderIcon, PlayIcon, RefreshIcon, TrashIcon,
} from '@/ui/icons'
import { formatBytes, useAppStore } from '@/app/data.ts'
import { formatDateTime, useI18n } from '@/app/theme.ts'
import { formatPlayTime, relativeTime } from '@/ui/grid-nav.ts'
import { PluginSlot } from '@/plugins/slots.tsx'
import { loaderLabel } from './archive-logic.ts'
import { formatLogLine, logLineClass, splitArgs, tailLines } from './instance-logic.ts'
import { LaunchOverlay } from '@/boot/LaunchOverlay.tsx'
import type { LaunchPhase, LaunchStage } from '@/boot/LaunchOverlay.tsx'
import './detail.css'

type DetailTab = 'overview' | 'mods' | 'logs' | 'settings'

interface Diagnostic {
  level: 'info' | 'warn' | 'error'
  message: string
  hint?: string
}

export default function InstanceDetailPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { t } = useI18n()
  const navigate = useNavigate()

  const instances = useAppStore((state) => state.instances)
  const sessions = useAppStore((state) => state.sessions)
  const accounts = useAppStore((state) => state.accounts)
  const javaRuntimes = useAppStore((state) => state.javaRuntimes)
  const patchInstance = useAppStore((state) => state.patchInstance)
  const removeInstance = useAppStore((state) => state.removeInstance)

  const instance = useMemo(() => instances.find((item) => item.id === id), [instances, id])
  const session = useMemo(
    () => sessions.find((item) => item.instanceId === id && (item.status === 'running' || item.status === 'starting')),
    [sessions, id],
  )

  const [tab, setTab] = useState<DetailTab>('overview')
  const [notes, setNotes] = useState(instance?.notes ?? '')
  const [savingNotes, setSavingNotes] = useState(false)
  const [mods, setMods] = useState<ModFile[] | null>(null)
  const [modsError, setModsError] = useState<string | null>(null)
  const [logs, setLogs] = useState('')
  const [logsLoading, setLogsLoading] = useState(false)
  const [files, setFiles] = useState<InstanceFile[] | null>(null)
  const [diagnostics, setDiagnostics] = useState<Diagnostic[] | null>(null)
  const [diagLoading, setDiagLoading] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [confirmDuplicate, setConfirmDuplicate] = useState(false)
  const [duplicateName, setDuplicateName] = useState('')
  const [busy, setBusy] = useState(false)
  const [importPath, setImportPath] = useState('')
  const [importOpen, setImportOpen] = useState(false)
  const [launch, setLaunch] = useState<{ stage: LaunchStage; phase: LaunchPhase; error?: string | null } | null>(null)

  const instanceId = instance?.id

  useEffect(() => {
    setNotes(instance?.notes ?? '')
  }, [instanceId, instance?.notes])

  const loadDiagnostics = useCallback(async () => {
    if (!id) return
    setDiagLoading(true)
    try {
      const result = await api.instances.diagnostics(id)
      setDiagnostics(Array.isArray(result) ? result : [])
    } catch {
      setDiagnostics([])
    } finally {
      setDiagLoading(false)
    }
  }, [id])

  useEffect(() => {
    void loadDiagnostics()
  }, [loadDiagnostics])

  const loadMods = useCallback(async () => {
    if (!id) return
    setModsError(null)
    try {
      setMods(await api.instances.mods(id))
    } catch (error) {
      setMods([])
      setModsError(error instanceof Error ? error.message : String(error))
    }
  }, [id])

  const loadFiles = useCallback(async () => {
    try {
      setFiles(await api.instances.files(id))
    } catch {
      setFiles([])
    }
  }, [id])

  const loadLogs = useCallback(async () => {
    if (!id) return
    setLogsLoading(true)
    try {
      const live = sessions.find((item) => item.instanceId === id)
      if (live) {
        const lines = (await api.launch.log(live.id, 400)).lines
        setLogs(lines.map(formatLogLine).join(String.fromCharCode(10)))
      } else {
        const file = await api.instances.readFile(id, 'logs/latest.log')
        setLogs(typeof file === 'string' ? file : file.content)
      }
    } catch {
      setLogs('')
    } finally {
      setLogsLoading(false)
    }
  }, [id, sessions])

  useEffect(() => {
    if (tab === 'mods') void loadMods()
    if (tab === 'logs') void loadLogs()
    if (tab === 'settings') void loadFiles()
  }, [tab, loadMods, loadLogs, loadFiles])

  const saveNotes = async () => {
    if (!instance) return
    setSavingNotes(true)
    try {
      const updated = await api.instances.update(instance.id, { notes })
      patchInstance(updated)
      toast.show({ level: 'ok', message: '备注已保存' })
    } catch (error) {
      toast.show({ level: 'error', message: '保存失败：' + errorText(error) })
    } finally {
      setSavingNotes(false)
    }
  }

  const doLaunch = async () => {
    if (!instance) return
    const account = accounts[0]
    if (!account) {
      toast.show({ level: 'warn', message: '还没有账号，请先在「账号」页添加' })
      navigate('/accounts')
      return
    }
    setLaunch({ stage: 'prepare', phase: 'running' })
    const tick = (stage: LaunchStage) => setLaunch((current) => (current ? { ...current, stage } : current))
    try {
      window.setTimeout(() => tick('verify'), 280)
      window.setTimeout(() => tick('java'), 640)
      const created = await api.launch.start({
        instanceId: instance.id,
        accountId: account.id,
        detach: true,
        memoryMb: instance.memory?.maxMb,
      })
      tick('spawn')
      setLaunch({ stage: 'running', phase: 'done' })
      toast.show({ level: 'ok', message: '游戏已启动（pid ' + (created.pid ?? '?') + '）' })
    } catch (error) {
      const message = errorText(error)
      setLaunch({ stage: 'spawn', phase: 'failed', error: message })
      toast.show({ level: 'error', message: t('instance.launch.failed') + '：' + message })
    }
  }

  const doDelete = async (deleteFiles: boolean) => {
    if (!instance) return
    setBusy(true)
    try {
      await api.instances.remove(instance.id, deleteFiles)
      removeInstance(instance.id)
      toast.show({ level: 'warn', message: '档案已删除' })
      navigate('/')
    } catch (error) {
      toast.show({ level: 'error', message: '删除失败：' + errorText(error) })
    } finally {
      setBusy(false)
      setConfirmDelete(false)
    }
  }

  const reveal = async (path: string) => {
    try {
      await api.system.reveal(path)
    } catch (error) {
      toast.show({ level: 'error', message: '无法打开目录：' + errorText(error) })
    }
  }

  const doImportMod = async () => {
    if (!instance || !importPath.trim()) return
    setBusy(true)
    try {
      await api.instances.importMod(instance.id, importPath.trim())
      toast.show({ level: 'ok', message: '模组已导入' })
      setImportOpen(false)
      setImportPath('')
      await loadMods()
    } catch (error) {
      toast.show({ level: 'error', message: '导入失败：' + errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  const doDuplicate = async () => {
    if (!instance) return
    setBusy(true)
    try {
      const copy = await api.instances.duplicate(instance.id, duplicateName || instance.name + ' 副本')
      patchInstance(copy)
      toast.show({ level: 'ok', message: '已复制为「' + copy.name + '」' })
      setConfirmDuplicate(false)
      navigate('/instances/' + encodeURIComponent(copy.id))
    } catch (error) {
      toast.show({ level: 'error', message: '复制失败：' + errorText(error) })
    } finally {
      setBusy(false)
    }
  }

  if (!instance) {
    return (
      <div className="rh-detail__missing">
        <EmptyState
          title="档案不存在"
          description="这份档案可能已经被删除，或者链接已经失效。"
          action={
            <Button variant="ghost" leading={<ArrowLeftIcon />} onClick={() => navigate('/')}>
              {t('common.back')}
            </Button>
          }
        />
      </div>
    )
  }

  const java = javaRuntimes.find((runtime) => runtime.path === instance.javaPath)

  return (
    <PluginSlot name="motion.card-expand" props={{ className: 'rh-detail' }}>
      <PluginSlot name="motion.dust" props={{ count: 24, seed: 13 }} />
      <PluginSlot name="motion.scanline" props={{ className: 'rh-detail__scan' }} />
      <span className="rh-detail__glass" aria-hidden="true" />
      <div className="rh-detail__head">
        <div className="rh-detail__titleblock">
          <div className="rh-detail__glyph" data-flip-target>
            {instance.icon ? <img src={instance.icon} alt="" /> : <ArchiveGlyph />}
          </div>
          <div className="rh-detail__titles">
            <span className="rh-caption rh-detail__caption">
              <Button variant="quiet" size="sm" leading={<ArrowLeftIcon />} onClick={() => navigate('/')}>
                {t('common.back')}
              </Button>
              <PluginSlot
                name="motion.text-decrypt"
                props={{ text: 'ARCHIVE / ' + instance.id.slice(0, 8).toUpperCase(), duration: 300 }}
                fallback={'ARCHIVE / ' + instance.id.slice(0, 8).toUpperCase()}
              />
            </span>
            <h1 className="rh-detail__name">
              <PluginSlot
                name="motion.text-decrypt"
                props={{ text: instance.name, duration: 380, trigger: instance.id }}
                fallback={instance.name}
              />
            </h1>
            <span className="rh-detail__badges">
              <Badge tone="muted" mono>
                {instance.gameVersion}
              </Badge>
              <Badge tone={instance.loaders?.length ? 'accent' : 'muted'}>{loaderLabel(instance.loaders)}</Badge>
              {session ? (
                <Badge tone="ok" mono>
                  运行中
                </Badge>
              ) : null}
              <span className="rh-card__statvalue">
                {t('instance.info.lastLaunch')}：{relativeTime(instance.lastLaunchedAt)}
              </span>
            </span>
          </div>
        </div>

        <div className="rh-detail__actions">
          <Button
            variant="ghost"
            leading={<CopyIcon />}
            onClick={() => {
              setDuplicateName(instance.name + ' 副本')
              setConfirmDuplicate(true)
            }}
          >
            {t('instance.action.duplicate')}
          </Button>
          <Button variant="danger" leading={<TrashIcon />} onClick={() => setConfirmDelete(true)}>
            {t('instance.action.delete')}
          </Button>
          <Button variant="primary" leading={<PlayIcon />} disabled={Boolean(session)} onClick={() => void doLaunch()}>
            {session ? '运行中' : t('instance.action.launch')}
          </Button>
        </div>
      </div>

      <Tabs
        className="rh-detail__tabs"
        value={tab}
        onChange={(key) => setTab(key as DetailTab)}
        ariaLabel={instance.name}
        items={[
          { key: 'overview', label: t('instance.tab.overview') },
          { key: 'mods', label: t('instance.tab.mods'), count: mods?.length },
          { key: 'logs', label: t('instance.tab.logs') },
          { key: 'settings', label: t('instance.tab.settings') },
        ]}
      />

      <div className="rh-detail__body" key={tab}>
        {tab === 'overview' ? (
          <div className="rh-detail__grid">
            <div className="rh-detail__stack">
              <Panel caption="SPECIFICATION" title="档案规格">
                <StatGrid
                  columns={2}
                  items={[
                    { caption: 'VERSION', label: t('instance.info.gameVersion'), value: instance.gameVersion },
                    { caption: 'LOADER', label: t('instance.info.loaders'), value: loaderLabel(instance.loaders) },
                    {
                      caption: 'MEMORY',
                      label: t('instance.info.memory'),
                      value: (instance.memory?.minMb ?? 0) + '–' + (instance.memory?.maxMb ?? 0) + ' MB',
                    },
                    { caption: 'PLAYTIME', label: t('instance.info.playTime'), value: formatPlayTime(instance.playTimeMs) },
                    { caption: 'CREATED', label: t('instance.info.created'), value: formatDateTime(instance.createdAt) },
                    { caption: 'LAST', label: t('instance.info.lastLaunch'), value: formatDateTime(instance.lastLaunchedAt) },
                  ]}
                />
              </Panel>

              <Panel
                caption="NOTES"
                title={t('instance.overview.notes')}
                actions={
                  <Button size="sm" variant="ghost" loading={savingNotes} onClick={() => void saveNotes()}>
                    {t('common.save')}
                  </Button>
                }
              >
                <Textarea
                  className="rh-detail__notes"
                  value={notes}
                  placeholder={t('instance.overview.notesPlaceholder')}
                  onChange={(event) => setNotes(event.target.value)}
                />
              </Panel>
            </div>

            <div className="rh-detail__stack">
              <Panel
                caption={t('instance.diagnostics.caption')}
                title={t('instance.diagnostics.title')}
                actions={
                  <Button size="sm" variant="quiet" leading={<RefreshIcon />} onClick={() => void loadDiagnostics()}>
                    {t('common.refresh')}
                  </Button>
                }
              >
                {diagLoading ? (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Spinner size="sm" />
                    <span className="rh-caption">{t('instance.diagnostics.running')}</span>
                  </div>
                ) : diagnostics && diagnostics.length > 0 ? (
                  <div className="rh-diag">
                    {diagnostics.map((item, index) => (
                      <div className="rh-diag__item" key={index}>
                        <AlertIcon
                          style={{
                            color:
                              item.level === 'error'
                                ? 'var(--rhine-danger)'
                                : item.level === 'warn'
                                  ? 'var(--rhine-warn)'
                                  : 'var(--rhine-muted)',
                            flex: 'none',
                            marginTop: 2,
                          }}
                        />
                        <span className="rh-diag__text">
                          <span>{item.message}</span>
                          {item.hint ? <span className="rh-diag__hint">{item.hint}</span> : null}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="rh-field__hint">{t('instance.diagnostics.empty')}</p>
                )}
              </Panel>

              <Panel
                caption="FILESYSTEM"
                title={t('instance.info.path')}
                actions={
                  <>
                    <Button size="sm" variant="quiet" leading={<CopyIcon />} onClick={() => copyPath(instance.path)}>
                      {t('common.copy')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      leading={<FolderIcon />}
                      onClick={() => void reveal(instance.path)}
                    >
                      {t('instance.action.openFolder')}
                    </Button>
                  </>
                }
              >
                <p className="rh-detail__path">{instance.path}</p>
                <PanelRows>
                  <PanelRow
                    label={t('instance.info.java')}
                    value={java ? java.version + ' (' + java.vendor + ')' : instance.javaPath || '自动'}
                  />
                  <PanelRow label="JVM ARGS" value={instance.jvmArgs?.length ? instance.jvmArgs.length + ' 项' : '默认'} />
                  <PanelRow label="GAME ARGS" value={instance.gameArgs?.length ? instance.gameArgs.length + ' 项' : '默认'} />
                </PanelRows>
              </Panel>
            </div>
          </div>
        ) : null}

        {tab === 'mods' ? (
          <Panel
            caption="MODS"
            title={instance.name + ' / 模组'}
            actions={
              <>
                <Button size="sm" variant="quiet" leading={<RefreshIcon />} onClick={() => void loadMods()}>
                  {t('common.refresh')}
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setImportOpen(true)}>
                  导入本地模组
                </Button>
              </>
            }
          >
            {mods === null ? (
              <Skeleton lines={4} />
            ) : mods.length === 0 ? (
              <EmptyState
                compact
                title={modsError ? t('error.panel.title') : '没有模组'}
                description={modsError ?? '把 .jar 放进实例的 mods/ 目录，或到市场安装。'}
              />
            ) : (
              <div className="rh-detail__filelist">
                {mods.map((mod) => (
                  <div className="rh-detail__filerow" key={mod.diskName}>
                    <Badge tone={mod.enabled ? 'accent' : 'muted'}>{mod.enabled ? 'ON' : 'OFF'}</Badge>
                    <span className="rh-detail__filename">{mod.meta?.name ?? mod.name}</span>
                    <span className="rh-detail__filemeta">{mod.meta?.version ?? ''}</span>
                    <span className="rh-detail__filemeta">{formatBytes(mod.size)}</span>
                  </div>
                ))}
              </div>
            )}
          </Panel>
        ) : null}

        {tab === 'logs' ? (
          <Panel
            caption="LOGS"
            title="最新日志"
            actions={
              <Button size="sm" variant="quiet" leading={<RefreshIcon />} onClick={() => void loadLogs()}>
                {t('common.refresh')}
              </Button>
            }
          >
            {logsLoading ? (
              <Skeleton lines={6} />
            ) : logs ? (
              <LogView text={logs} />
            ) : (
              <EmptyState compact title="暂无日志" description="启动一次游戏后，这里会显示 logs/latest.log 的尾部内容。" />
            )}
          </Panel>
        ) : null}

        {tab === 'settings' ? <InstanceSettingsPanel instance={instance} files={files} onSaved={patchInstance} label={t} /> : null}
      </div>

      <Dialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        caption="DELETE"
        title={t('instance.delete.title')}
        width={460}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDelete(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="ghost" loading={busy} onClick={() => void doDelete(false)}>
              {t('instance.delete.onlyConfig')}
            </Button>
            <Button variant="danger" loading={busy} onClick={() => void doDelete(true)}>
              {t('instance.delete.withFiles')}
            </Button>
          </>
        }
      >
        <p className="rh-field__hint" style={{ fontSize: 13, lineHeight: 1.6 }}>
          {t('instance.delete.desc', { name: instance.name })}
        </p>
      </Dialog>

      <Dialog
        open={importOpen}
        onClose={() => setImportOpen(false)}
        caption="IMPORT"
        title="导入本地模组"
        width={460}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setImportOpen(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} disabled={!importPath.trim()} onClick={() => void doImportMod()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <Field label="模组文件路径" caption="SOURCE" hint="填写磁盘上的 .jar 绝对路径，启动器会复制到实例的 mods/ 目录。">
          <Input
            mono
            value={importPath}
            placeholder="D:/Downloads/example-mod.jar"
            onChange={(event) => setImportPath(event.target.value)}
          />
        </Field>
      </Dialog>

      <Dialog
        open={confirmDuplicate}
        onClose={() => setConfirmDuplicate(false)}
        caption="DUPLICATE"
        title={t('instance.duplicate.title')}
        width={420}
        footer={
          <>
            <Button variant="ghost" disabled={busy} onClick={() => setConfirmDuplicate(false)}>
              {t('common.cancel')}
            </Button>
            <Button variant="primary" loading={busy} onClick={() => void doDuplicate()}>
              {t('common.confirm')}
            </Button>
          </>
        }
      >
        <Field label={t('instance.duplicate.name')} htmlFor="dup-name">
          <Input id="dup-name" value={duplicateName} onChange={(event) => setDuplicateName(event.target.value)} />
        </Field>
      </Dialog>

      {launch ? (
        <LaunchOverlay
          open
          t={t}
          instanceName={instance.name}
          gameVersion={instance.gameVersion}
          stage={launch.stage}
          phase={launch.phase}
          error={launch.error}
          onDismiss={() => setLaunch(null)}
        />
      ) : null}
    </PluginSlot>
  )
}

/* ------------------------------------------------------------------ */
/* sub-components                                                      */
/* ------------------------------------------------------------------ */

interface InstanceSettingsPanelProps {
  instance: Instance
  files: InstanceFile[] | null
  onSaved: (instance: Instance) => void
  label: ReturnType<typeof useI18n>['t']
}

function InstanceSettingsPanel({ instance, files, onSaved, label }: InstanceSettingsPanelProps) {
  const [name, setName] = useState(instance.name)
  const [maxMb, setMaxMb] = useState(instance.memory?.maxMb ?? 4096)
  const [jvmArgs, setJvmArgs] = useState((instance.jvmArgs ?? []).join(' '))
  const [gameArgs, setGameArgs] = useState((instance.gameArgs ?? []).join(' '))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    setSaving(true)
    try {
      const updated = await api.instances.update(instance.id, {
        name: name.trim() || instance.name,
        memory: { minMb: Math.min(1024, maxMb), maxMb },
        jvmArgs: splitArgs(jvmArgs),
        gameArgs: splitArgs(gameArgs),
      })
      onSaved(updated)
      toast.show({ level: 'ok', message: '实例设置已保存' })
    } catch (error) {
      toast.show({ level: 'error', message: '保存失败：' + errorText(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="rh-detail__grid">
      <div className="rh-detail__stack">
        <Panel caption="INSTANCE" title="基本信息">
          <Field label="名称" htmlFor="inst-name">
            <Input id="inst-name" value={name} onChange={(event) => setName(event.target.value)} />
          </Field>
          <Field label={label('instance.info.gameVersion')} caption="VERSION">
            <Input value={instance.gameVersion} readOnly mono />
          </Field>
          <Field label={label('instance.info.loaders')} caption="LOADER">
            <Input value={loaderLabel(instance.loaders)} readOnly />
          </Field>
        </Panel>

        <Panel caption="JVM" title="内存与参数">
          <Field label={label('instance.info.memory')} hint={maxMb + ' MB'}>
            <Input
              type="range"
              min={1024}
              max={16384}
              step={512}
              value={maxMb}
              onChange={(event) => setMaxMb(Number(event.target.value))}
            />
          </Field>
          <Field label="JVM 参数" caption="JVM ARGS" hint="空格分隔；留空使用启动器默认值。">
            <Input mono value={jvmArgs} onChange={(event) => setJvmArgs(event.target.value)} />
          </Field>
          <Field label="游戏参数" caption="GAME ARGS" hint="空格分隔，追加在游戏参数末尾。">
            <Input mono value={gameArgs} onChange={(event) => setGameArgs(event.target.value)} />
          </Field>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 12 }}>
            <Button variant="primary" size="sm" loading={saving} onClick={() => void save()}>
              {label('common.save')}
            </Button>
          </div>
        </Panel>
      </div>

      <div className="rh-detail__stack">
        <Panel caption="FILES" title="实例目录">
          {files === null ? (
            <Skeleton lines={5} />
          ) : files.length === 0 ? (
            <p className="rh-field__hint">目录为空。</p>
          ) : (
            <div className="rh-detail__filelist">
              {files.map((file) => (
                <div className="rh-detail__filerow" key={file.path}>
                  <FolderIcon style={{ flex: 'none', color: 'var(--rhine-muted)' }} />
                  <span className="rh-detail__filename">{file.name}</span>
                  <span className="rh-detail__filemeta">{file.isDirectory ? 'DIR' : formatBytes(file.size)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </div>
  )
}

function LogView({ text }: { text: string }) {
  const newline = String.fromCharCode(10)
  return (
    <pre className="rh-detail__log">
      {tailLines(text, 400).map((line, index) => (
        <span className={logLineClass(line)} key={index}>
          {line}
          {newline}
        </span>
      ))}
    </pre>
  )
}

function ArchiveGlyph() {
  return (
    <svg width="26" height="26" viewBox="0 0 26 26" fill="none" stroke="currentColor" strokeWidth="1" aria-hidden="true">
      <rect x="3" y="7" width="20" height="15" />
      <path d="M3 7L5.5 3h15L23 7" />
      <path d="M10 12h6" />
    </svg>
  )
}

function copyPath(path: string): void {
  if (navigator.clipboard?.writeText) {
    void navigator.clipboard.writeText(path).then(
      () => toast.show({ level: 'ok', message: '路径已复制' }),
      () => toast.show({ level: 'info', message: path }),
    )
  } else {
    toast.show({ level: 'info', message: path })
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}