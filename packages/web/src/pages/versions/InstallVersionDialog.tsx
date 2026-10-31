/**
 * Install dialog: pick a target game version and (optionally) a loader build.
 * Actual work happens in a backend task, so the dialog only has to create it
 * and report the task id.
 */
import { useEffect, useState } from 'react'
import type { LoaderKind, LoaderVersion } from '@rhine/core'
import { api } from '@/api/client'
import { Badge, Button, Dialog, Field, Select, Spinner, toast } from '@/ui'
import type { Translator } from '@/app/i18n'
import { INSTALL_LOADERS, preferredLoaderVersion } from './versions-logic.ts'

export interface InstallVersionDialogProps {
  open: boolean
  onClose: () => void
  t: Translator
  /** Preselected target version id. */
  target: string | null
  /** Remote manifest, used for the manual target picker. */
  versions: string[]
  /** Called with the created task id so the caller can track progress. */
  onStarted: (taskId: string) => void
}

export function InstallVersionDialog({ open, onClose, t, target, versions, onStarted }: InstallVersionDialogProps) {
  const [gameVersion, setGameVersion] = useState(target ?? '')
  const [loader, setLoader] = useState<LoaderKind>('vanilla')
  const [loaderVersions, setLoaderVersions] = useState<LoaderVersion[] | null>(null)
  const [loaderVersion, setLoaderVersion] = useState('')
  const [loading, setLoading] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  useEffect(() => {
    if (!open) return
    setGameVersion(target ?? '')
    setLoader('vanilla')
    setLoaderVersion('')
    setLoaderVersions(null)
  }, [open, target])

  useEffect(() => {
    if (!open || loader === 'vanilla' || !gameVersion) {
      setLoaderVersions(null)
      setLoaderVersion('')
      return
    }
    let cancelled = false
    setLoading(true)
    api.loaders(loader, gameVersion)
      .then((list) => {
        if (cancelled) return
        setLoaderVersions(list)
        setLoaderVersion(preferredLoaderVersion(list) ?? '')
      })
      .catch(() => {
        if (!cancelled) setLoaderVersions([])
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [open, loader, gameVersion])

  const submit = async () => {
    if (!gameVersion) return
    setSubmitting(true)
    try {
      if (loader !== 'vanilla' && loaderVersion) {
        const { taskId } = await api.loaders.install(loader, gameVersion, loaderVersion)
        toast.show({ level: 'ok', message: t('versions.install.queued') + '：' + loader + ' ' + loaderVersion })
        onStarted(taskId)
      } else {
        const { taskId } = await api.versions.install(gameVersion)
        toast.show({ level: 'ok', message: t('versions.install.queued') + '：' + gameVersion })
        onStarted(taskId)
      }
      onClose()
    } catch (error) {
      toast.show({
        level: 'error',
        message: t('versions.install.failed') + '：' + (error instanceof Error ? error.message : String(error)),
      })
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      caption={t('versions.install.caption')}
      title={t('versions.install.title')}
      width={520}
      footer={
        <>
          <Button variant="quiet" onClick={onClose} disabled={submitting}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={submitting} disabled={!gameVersion} onClick={() => void submit()}>
            {t('versions.action.install')}
          </Button>
        </>
      }
    >
      <Field label={t('versions.install.target')} caption="GAME VERSION" required htmlFor="install-target">
        {versions.length > 0 ? (
          <Select
            id="install-target"
            value={gameVersion}
            onChange={(event) => setGameVersion(event.target.value)}
          >
            {versions.map((id) => (
              <option key={id} value={id}>
                {id}
              </option>
            ))}
          </Select>
        ) : (
          <Select id="install-target" value={gameVersion} onChange={(event) => setGameVersion(event.target.value)}>
            <option value="">{t('create.version.empty')}</option>
          </Select>
        )}
      </Field>

      <Field
        label={t('versions.install.loader')}
        caption="LOADER"
        hint={loader === 'vanilla' ? '仅安装原版版本（不附加加载器）。' : '安装时会先写入原版版本，再合并加载器 profile。'}
        htmlFor="install-loader"
      >
        <Select id="install-loader" value={loader} onChange={(event) => setLoader(event.target.value as LoaderKind)}>
          {INSTALL_LOADERS.map((item) => (
            <option key={item.kind} value={item.kind}>
              {item.label}
            </option>
          ))}
        </Select>
      </Field>

      {loader !== 'vanilla' ? (
        <Field
          label={t('create.loader.version')}
          caption="BUILD"
          hint={
            loading
              ? t('common.loading')
              : loaderVersions && loaderVersions.length === 0
                ? t('versions.loader.empty')
                : undefined
          }
          htmlFor="install-loader-version"
        >
          <Select
            id="install-loader-version"
            value={loaderVersion}
            disabled={loading || !loaderVersions || loaderVersions.length === 0}
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

      {loading ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <Spinner size="sm" />
          <span className="rh-caption">{t('versions.loader.title')}</span>
        </div>
      ) : null}
    </Dialog>
  )
}
