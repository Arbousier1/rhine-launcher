/**
 * "New archive" dialog.
 *
 * Versions come from the live manifest (Minecraft version numbers moved to a
 * date-based scheme, so nothing is hard-coded). When the manifest cannot be
 * fetched the dialog degrades to a manual version input instead of blocking.
 */
import { useEffect, useMemo, useState } from 'react'
import type { LoaderKind, LoaderVersion, RemoteVersion } from '@rhine/core'
import { api } from '@/api/client'
import { Badge, Button, Dialog, Field, Input, Select, Spinner } from '@/ui'
import { toast } from '@/ui/toast.tsx'
import type { Translator } from '@/app/i18n'

export interface CreateArchiveDialogProps {
  open: boolean
  onClose: () => void
  t: Translator
  /** Called after the instance was created successfully. */
  onCreated: (id: string) => void
}

const LOADER_OPTIONS: { value: LoaderKind; label: string }[] = [
  { value: 'vanilla', label: '原版 / Vanilla' },
  { value: 'fabric', label: 'Fabric' },
  { value: 'quilt', label: 'Quilt' },
  { value: 'forge', label: 'Forge' },
  { value: 'neoforge', label: 'NeoForge' },
  { value: 'optifine', label: 'OptiFine' },
]

const DEFAULT_MAX_MB = 4096

export function CreateArchiveDialog({ open, onClose, t, onCreated }: CreateArchiveDialogProps) {
  const [mode, setMode] = useState<'create' | 'modpack'>('create')
  const [modpackPath, setModpackPath] = useState('')
  const [name, setName] = useState('')
  const [version, setVersion] = useState('')
  const [loader, setLoader] = useState<LoaderKind>('vanilla')
  const [loaderVersion, setLoaderVersion] = useState('')
  const [maxMb, setMaxMb] = useState(DEFAULT_MAX_MB)
  const [versions, setVersions] = useState<RemoteVersion[] | null>(null)
  const [versionsError, setVersionsError] = useState<string | null>(null)
  const [loadingVersions, setLoadingVersions] = useState(false)
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[] | null>(null)
  const [loadingLoaders, setLoadingLoaders] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [touched, setTouched] = useState(false)

  // Reset the form every time the dialog opens.
  useEffect(() => {
    if (!open) return
    setName('')
    setVersion('')
    setLoader('vanilla')
    setLoaderVersion('')
    setMaxMb(DEFAULT_MAX_MB)
    setTouched(false)
  }, [open])

  // Load the remote manifest once per open.
  useEffect(() => {
    if (!open || versions) return
    let cancelled = false
    setLoadingVersions(true)
    setVersionsError(null)
    api.versions
      .remote()
      .then((list) => {
        if (cancelled) return
        setVersions(list)
        const latest = list.find((item) => item.type === 'release') ?? list[0]
        if (latest) setVersion((current) => current || latest.id)
      })
      .catch((error: unknown) => {
        if (cancelled) return
        setVersionsError(error instanceof Error ? error.message : String(error))
      })
      .finally(() => {
        if (!cancelled) setLoadingVersions(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, versions])

  // Load loader builds whenever the pair changes.
  useEffect(() => {
    if (!open || loader === 'vanilla' || !version) {
      setLoaderVersions(null)
      setLoaderVersion('')
      return
    }
    let cancelled = false
    setLoadingLoaders(true)
    api.loaders(loader, version)
      .then((list) => {
        if (cancelled) return
        setLoaderVersions(list)
        setLoaderVersion(list[0]?.version ?? '')
      })
      .catch(() => {
        if (!cancelled) setLoaderVersions([])
      })
      .finally(() => {
        if (!cancelled) setLoadingLoaders(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, loader, version])

  const selectedVersion = useMemo(
    () => versions?.find((item) => item.id === version),
    [versions, version],
  )

  const nameError = touched && !name.trim() ? t('create.error.name') : null
  const versionError = touched && !version.trim() ? t('create.error.version') : null
  const loaderError =
    touched && loader !== 'vanilla' && loaderVersions !== null && loaderVersions.length > 0 && !loaderVersion
      ? t('create.error.loader')
      : null

  const submit = async () => {
    setTouched(true)
    if (mode === 'modpack') {
      if (!modpackPath.trim()) return
      setSubmitting(true)
      try {
        await api.instances.importModpack(modpackPath.trim(), name.trim() || undefined)
        toast.show({ level: 'ok', message: '整合包导入任务已启动，请在任务列表查看进度' })
        onClose()
      } catch (error) {
        toast.show({
          level: 'error',
          message: '导入失败：' + (error instanceof Error ? error.message : String(error)),
        })
      } finally {
        setSubmitting(false)
      }
      return
    }
    if (!name.trim() || !version.trim()) return
    setSubmitting(true)
    try {
      const instance = await api.instances.create({
        name: name.trim(),
        gameVersion: version.trim(),
        loaders: loader === 'vanilla' ? [] : [{ kind: loader, version: loaderVersion || undefined }],
        memory: { minMb: Math.min(1024, maxMb), maxMb },
        jvmArgs: [],
        gameArgs: [],
        window: { width: 1280, height: 720, fullscreen: false },
      })
      toast.show({ level: 'ok', message: '档案「' + instance.name + '」已创建' })
      onCreated(instance.id)
      onClose()
    } catch (error) {
      toast.show({
        level: 'error',
        message: '创建失败：' + (error instanceof Error ? error.message : String(error)),
      })
    } finally {
      setSubmitting(false)
    }
  }

  const releaseVersions = useMemo(
    () => (versions ?? []).filter((item) => item.type === 'release'),
    [versions],
  )
  const otherVersions = useMemo(
    () => (versions ?? []).filter((item) => item.type !== 'release'),
    [versions],
  )

  return (
    <Dialog
      open={open}
      onClose={onClose}
      caption={t('create.caption')}
      title={t('create.title')}
      width={560}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={() => void submit()} loading={submitting}>
            {t('create.submit')}
          </Button>
        </>
      }
    >
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <Button
          variant={mode === 'create' ? 'primary' : 'quiet'}
          onClick={() => setMode('create')}
        >
          新建空白档案
        </Button>
        <Button
          variant={mode === 'modpack' ? 'primary' : 'quiet'}
          onClick={() => setMode('modpack')}
        >
          导入整合包 (.mrpack / .zip)
        </Button>
      </div>

      {mode === 'modpack' ? (
        <>
          <Field
            label="整合包路径 (.mrpack / .zip)"
            caption="MODPACK ARCHIVE"
            required
            error={touched && !modpackPath.trim() ? '请输入或粘贴整合包文件的绝对路径' : undefined}
          >
            <Input
              value={modpackPath}
              autoFocus
              placeholder="E:\downloads\Fabulously_Optimized.mrpack"
              onChange={(e) => setModpackPath(e.target.value)}
            />
          </Field>
          <Field label="自定义档案名称（可选）" caption="INSTANCE NAME">
            <Input
              value={name}
              placeholder="留空则使用整合包预设名称"
              onChange={(e) => setName(e.target.value)}
            />
          </Field>
        </>
      ) : (
        <>
      <Field label={t('create.name')} required error={nameError} htmlFor="create-name">
        <Input
          id="create-name"
          value={name}
          autoFocus
          placeholder={t('create.name.placeholder')}
          invalid={Boolean(nameError)}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') void submit()
          }}
        />
      </Field>

      <Field
        label={t('create.version')}
        caption="GAME VERSION"
        required
        error={versionError}
        hint={
          loadingVersions
            ? t('create.loadingVersions')
            : versionsError
              ? t('create.versionsFailed')
              : selectedVersion
                ? t('versions.type.' + selectedVersion.type) + ' · ' + selectedVersion.releaseTime.slice(0, 10)
                : undefined
        }
        htmlFor="create-version"
      >
        {versions && versions.length > 0 ? (
          <Select
            id="create-version"
            value={version}
            invalid={Boolean(versionError)}
            onChange={(event) => setVersion(event.target.value)}
          >
            {releaseVersions.length > 0 ? (
              <optgroup label="正式版">
                {releaseVersions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name || item.id}
                  </option>
                ))}
              </optgroup>
            ) : null}
            {otherVersions.length > 0 ? (
              <optgroup label="快照 / 远古版本">
                {otherVersions.map((item) => (
                  <option key={item.id} value={item.id}>
                    {item.name || item.id} · {item.type}
                  </option>
                ))}
              </optgroup>
            ) : null}
          </Select>
        ) : (
          <Input
            id="create-version"
            value={version}
            mono
            placeholder={t('create.versionManual')}
            invalid={Boolean(versionError)}
            onChange={(event) => setVersion(event.target.value)}
            suffix={loadingVersions ? <Spinner size="sm" /> : undefined}
          />
        )}
      </Field>

      <Field label={t('create.loader')} caption="LOADER" htmlFor="create-loader">
        <Select id="create-loader" value={loader} onChange={(event) => setLoader(event.target.value as LoaderKind)}>
          {LOADER_OPTIONS.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </Select>
      </Field>

      {loader !== 'vanilla' ? (
        <Field
          label={t('create.loader.version')}
          caption="BUILD"
          error={loaderError}
          hint={loaderVersions && loaderVersions.length === 0 ? t('versions.loader.empty') : undefined}
          htmlFor="create-loader-version"
        >
          <Select
            id="create-loader-version"
            value={loaderVersion}
            disabled={loadingLoaders || !loaderVersions || loaderVersions.length === 0}
            onChange={(event) => setLoaderVersion(event.target.value)}
          >
            {(loaderVersions ?? []).map((item) => (
              <option key={item.version} value={item.version}>
                {item.version}
                {item.stable === false ? ' (beta)' : ''}
              </option>
            ))}
          </Select>
        </Field>
      ) : null}

      <Field label={t('create.memory')} caption="MEMORY" hint={maxMb + ' MB'}>
        <Input
          type="range"
          min={1024}
          max={16384}
          step={512}
          value={maxMb}
          onChange={(event) => setMaxMb(Number(event.target.value))}
        />
        <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
          {[2048, 4096, 8192].map((value) => (
            <Badge key={value} tone={maxMb === value ? 'accent' : 'muted'}>
              <button type="button" onClick={() => setMaxMb(value)}>
                {value} MB
              </button>
            </Badge>
          ))}
        </div>
      </Field>
      </>
      )}
    </Dialog>
  )
}
