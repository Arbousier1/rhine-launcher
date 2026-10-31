/**
 * Settings page.
 *
 * Every field writes into a local draft; a sticky save bar appears only when
 * the draft differs from what the backend persisted, and the patch sent back
 * is the minimal diff so unrelated sections are never rewritten.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import clsx from 'clsx'
import type { Settings } from '@rhine/core'
import { api } from '@/api/client'
import { Button, Input, Panel, Switch, toast } from '@/ui'
import { FolderIcon, RefreshIcon } from '@/ui/icons'
import { PageHead } from '@/features/common/PageHead'
import { Notice, StatStrip } from '@/features/common/toolbar'
import { useAppStore } from '@/stores'
import {
  DOWNLOAD_SOURCES, LANGUAGES, LIMITS, MIRROR_FIELDS, THEMES, clampInt, cloneSettings,
  diffSettings, maskSecret, validateSettings, type SettingsErrors,
} from '@/features/settings/settings.ts'
import page from '@/features/common/page.module.css'
import styles from './settings.module.css'

export default function SettingsPage() {
  const settings = useAppStore((state) => state.settings)
  const paths = useAppStore((state) => state.paths)
  const app = useAppStore((state) => state.app)
  const reload = useAppStore((state) => state.reload)
  const patchSettings = useAppStore((state) => state.patchSettings)

  const [draft, setDraft] = useState<Settings | null>(() => (settings ? cloneSettings(settings) : null))
  const [saving, setSaving] = useState(false)
  const [showKey, setShowKey] = useState(false)
  const [errors, setErrors] = useState<SettingsErrors>({})

  // Adopt the persisted settings whenever they arrive or change underneath us.
  useEffect(() => {
    if (settings) setDraft(cloneSettings(settings))
  }, [settings])

  const patch = useMemo(() => (draft && settings ? diffSettings(settings, draft) : {}), [draft, settings])
  const dirty = Object.keys(patch).length > 0

  const update = useCallback(<K extends keyof Settings>(key: K, value: Settings[K]) => {
    setDraft((current) => (current ? { ...current, [key]: value } : current))
  }, [])

  const updateMirror = useCallback((key: keyof Settings['mirrors'], value: string) => {
    setDraft((current) => (current
      ? { ...current, mirrors: { ...current.mirrors, [key]: value } }
      : current))
  }, [])

  const updateProxy = useCallback((patchProxy: Partial<NonNullable<Settings['proxy']>>) => {
    setDraft((current) => (current
      ? {
          ...current,
          proxy: {
            enabled: current.proxy?.enabled ?? false,
            host: current.proxy?.host ?? '',
            port: current.proxy?.port ?? 7890,
            ...patchProxy,
          },
        }
      : current))
  }, [])

  const save = useCallback(async () => {
    if (!draft) return
    const found = validateSettings(draft)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      toast.show({ level: 'warn', message: '有 ' + Object.keys(found).length + ' 项设置需要修正' })
      return
    }
    const body = diffSettings(settings ?? draft, draft)
    if (Object.keys(body).length === 0) return
    setSaving(true)
    try {
      const saved = await api.settings.update(body)
      patchSettings(saved)
      document.documentElement.dataset.theme = saved.theme
      toast.show({ level: 'ok', message: '设置已保存' })
    } catch (cause) {
      toast.show({ level: 'error', message: '保存失败：' + message(cause) })
    } finally {
      setSaving(false)
    }
  }, [draft, patchSettings, settings])

  const reset = useCallback(() => {
    if (settings) setDraft(cloneSettings(settings))
    setErrors({})
  }, [settings])

  const openDataDir = useCallback(async () => {
    const target = paths?.root
    if (!target) return
    try {
      await api.system.reveal(target)
    } catch (cause) {
      toast.show({ level: 'error', message: '无法打开目录：' + message(cause) })
    }
  }, [paths])

  if (!draft) {
    return (
      <div className={page.stack}>
        <PageHead caption="SETTINGS" title="设置" />
        <Panel><p className={page.placeholder}>正在加载设置…</p></Panel>
      </div>
    )
  }

  return (
    <div className={page.stack}>
      <PageHead
        caption="SETTINGS"
        title="设置"
        description="启动器行为、下载源与界面偏好；保存后立即生效"
        actions={
          <>
            <Button
              variant="ghost"
              leading={<RefreshIcon />}
              onClick={() => void reload()}
            >
              重新读取
            </Button>
            <Button variant="primary" loading={saving} disabled={!dirty} onClick={() => void save()}>
              保存设置
            </Button>
          </>
        }
      />

      <StatStrip
        items={[
          { caption: 'VERSION', value: app?.version ?? '—', hint: '启动器版本' },
          { caption: 'PLATFORM', value: app?.platform ?? '—', hint: '运行平台' },
          { caption: 'CONCURRENCY', value: draft.concurrency, hint: '并发下载数' },
          { caption: 'THEME', value: themeLabel(draft.theme), hint: '界面主题' },
        ]}
      />

      {Object.keys(errors).length > 0 ? (
        <Notice level="danger" title="无法保存">
          有 {Object.keys(errors).length} 项输入无效，请检查标红的字段。
        </Notice>
      ) : null}

      {/* ---------------- general ---------------- */}
      <Panel caption="GENERAL" title="通用">
        <Row title="界面语言" hint="切换后需要刷新页面让文案完全生效。">
          <div className={styles.languageRow}>
            {LANGUAGES.map((language) => (
              <Button
                key={language.key}
                size="sm"
                variant={draft.language === language.key ? 'primary' : 'ghost'}
                onClick={() => update('language', language.key)}
              >
                {language.label}
              </Button>
            ))}
          </div>
        </Row>

        <Row title="界面主题" hint="档案（默认暖灰白）、午夜（深色）与明亮。">
          <div className={styles.languageRow}>
            {THEMES.map((theme) => (
              <Button
                key={theme.key}
                size="sm"
                variant={draft.theme === theme.key ? 'primary' : 'ghost'}
                title={theme.hint}
                onClick={() => update('theme', theme.key)}
              >
                {theme.label}
              </Button>
            ))}
          </div>
        </Row>

        <Row title="数据目录" hint="实例、资源、库与 Java 运行时的存放位置；留空使用默认目录。">
          <div className={styles.pathRow}>
            <Input
              className={styles.pathValue}
              mono
              value={draft.dataDir ?? ''}
              placeholder={paths?.root ?? '默认目录'}
              invalid={Boolean(errors.dataDir)}
              onChange={(event) => update('dataDir', event.target.value.trim() ? event.target.value : null)}
            />
            <Button variant="ghost" leading={<FolderIcon />} onClick={() => void openDataDir()}>
              打开
            </Button>
          </div>
          {errors.dataDir ? <span className={styles.keyHint}>{errors.dataDir}</span> : null}
          <span className={styles.keyHint}>
            当前生效目录：<span className="rh-mono">{paths?.root ?? '未知'}</span>
          </span>
        </Row>

        <Row title="并发下载数" hint="同时进行的下载任务数量，网络较差时建议降低。">
          <div className={styles.numberRow}>
            <Input
              type="number"
              min={LIMITS.concurrency.min}
              max={LIMITS.concurrency.max}
              value={String(draft.concurrency)}
              invalid={Boolean(errors.concurrency)}
              onChange={(event) => {
                const value = clampInt(event.target.value, LIMITS.concurrency.min, LIMITS.concurrency.max)
                update('concurrency', value ?? draft.concurrency)
              }}
            />
            <span className={styles.keyHint}>范围 {LIMITS.concurrency.min} – {LIMITS.concurrency.max}</span>
          </div>
          {errors.concurrency ? <span className={styles.keyHint}>{errors.concurrency}</span> : null}
        </Row>

        <Row title="保留日志数" hint="每个实例保留的最近日志文件数量，超出后自动清理。">
          <div className={styles.numberRow}>
            <Input
              type="number"
              min={LIMITS.keepLogs.min}
              max={LIMITS.keepLogs.max}
              value={String(draft.keepLogs)}
              invalid={Boolean(errors.keepLogs)}
              onChange={(event) => {
                const value = clampInt(event.target.value, LIMITS.keepLogs.min, LIMITS.keepLogs.max)
                update('keepLogs', value ?? draft.keepLogs)
              }}
            />
            <span className={styles.keyHint}>范围 {LIMITS.keepLogs.min} – {LIMITS.keepLogs.max}</span>
          </div>
          {errors.keepLogs ? <span className={styles.keyHint}>{errors.keepLogs}</span> : null}
        </Row>
      </Panel>

      {/* ---------------- download ---------------- */}
      <Panel caption="DOWNLOAD" title="下载">
        <Row title="下载源" hint="镜像源可以显著提升国内下载速度，但可能滞后于官方。">
          <div className={styles.languageRow}>
            {DOWNLOAD_SOURCES.map((source) => (
              <Button
                key={source.key}
                size="sm"
                variant={draft.downloadSource === source.key ? 'primary' : 'ghost'}
                title={source.hint}
                onClick={() => update('downloadSource', source.key)}
              >
                {source.label}
              </Button>
            ))}
          </div>
        </Row>

        <Row title="显示快照版本" hint="在版本列表中包含 Mojang 的快照与旧版本。">
          <Switch
            checked={draft.showSnapshots}
            onCheckedChange={(checked) => update('showSnapshots', checked)}
            label={draft.showSnapshots ? '显示' : '隐藏'}
          />
        </Row>

        <Row title="自动下载 Java" hint="没有匹配的 Java 运行时且开启此项时，会自动下载 Mojang 提供的运行时。">
          <Switch
            checked={draft.autoDownloadJava}
            onCheckedChange={(checked) => update('autoDownloadJava', checked)}
            label={draft.autoDownloadJava ? '开启' : '关闭'}
          />
        </Row>

        <Row title="代理" hint="所有下载与 API 请求都会走该代理；修改后立即生效。">
          <div className={styles.pathRow}>
            <Switch
              checked={draft.proxy?.enabled ?? false}
              onCheckedChange={(checked) => updateProxy({ enabled: checked })}
              label={draft.proxy?.enabled ? '已启用' : '未启用'}
            />
            <Input
              placeholder="127.0.0.1"
              value={draft.proxy?.host ?? ''}
              disabled={!draft.proxy?.enabled}
              invalid={Boolean(errors['proxy.host'])}
              onChange={(event) => updateProxy({ host: event.target.value })}
            />
            <Input
              type="number"
              placeholder="7890"
              className={styles.numberRow}
              value={String(draft.proxy?.port ?? '')}
              disabled={!draft.proxy?.enabled}
              invalid={Boolean(errors['proxy.port'])}
              onChange={(event) => updateProxy({ port: Number(event.target.value) || 0 })}
            />
          </div>
          {errors['proxy.host'] || errors['proxy.port'] ? (
            <span className={styles.keyHint}>{errors['proxy.host'] ?? errors['proxy.port']}</span>
          ) : null}
        </Row>
      </Panel>

      <Panel caption="MICROSOFT AUTHENTICATION" title="微软应用注册">
        <p>使用为本启动器注册的 Microsoft 公共客户端应用 ID。启动器不会冒用其他项目的应用身份；设备码授权须由你在微软页面完成。</p>
        <label className="rh-caption" htmlFor="microsoft-client-id">CLIENT ID</label>
        <Input id="microsoft-client-id" value={draft.microsoftClientId??''} onChange={event=>update('microsoftClientId',event.target.value.trim())} placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" />
        <label className="rh-caption" htmlFor="microsoft-authority">AUTHORITY</label>
        <Input id="microsoft-authority" value={draft.microsoftAuthority??''} onChange={event=>update('microsoftAuthority',event.target.value.trim())} placeholder="https://login.microsoftonline.com/consumers" />
        <p><a href="https://learn.microsoft.com/entra/identity-platform/quickstart-register-app" target="_blank" rel="noreferrer">微软应用注册说明</a> · 启用公共客户端与个人 Microsoft 账号支持。</p>
      </Panel>

      {/* ---------------- mirrors ---------------- */}
      <Panel caption="MIRRORS" title="下载地址">
        <p className={clsx(page.dim, page.tiny)}>
          这些地址决定版本清单、资源、库与各加载器元数据的来源；一般不需要修改。
        </p>
        <div className={styles.mirrorGrid}>
          {MIRROR_FIELDS.map((field) => {
            const key = 'mirrors.' + field.key
            return (
              <div className={styles.mirrorItem} key={field.key}>
                <span className={styles.mirrorLabel}>
                  <span>{field.label}</span>
                  {errors[key] ? <span className={page.dangerText}>{errors[key]}</span> : null}
                </span>
                <Input
                  mono
                  value={draft.mirrors[field.key]}
                  invalid={Boolean(errors[key])}
                  onChange={(event) => updateMirror(field.key, event.target.value)}
                />
                {field.hint ? <span className={styles.mirrorHint}>{field.hint}</span> : null}
              </div>
            )
          })}
        </div>
      </Panel>

      {/* ---------------- integrations ---------------- */}
      <Panel caption="INTEGRATIONS" title="第三方服务">
        <Row
          title="CurseForge API Key（可选）"
          hint="有自有 Key 时优先直连官方 API；留空则自动走镜像源，仍可搜索与下载。"
        >
          <div className={styles.secretWrap}>
            <Input
              mono
              type={showKey ? 'text' : 'password'}
              className={page.grow}
              placeholder="$2a$10$…"
              value={draft.curseforgeApiKey ?? ''}
              invalid={Boolean(errors.curseforgeApiKey)}
              onChange={(event) => update('curseforgeApiKey', event.target.value || undefined)}
              suffix={
                <Button size="sm" variant="quiet" onClick={() => setShowKey((value) => !value)}>
                  {showKey ? '隐藏' : '显示'}
                </Button>
              }
            />
          </div>
          {errors.curseforgeApiKey ? (
            <span className={page.dangerText}>{errors.curseforgeApiKey}</span>
          ) : null}
          {draft.curseforgeApiKey && !showKey ? (
            <span className={page.monoText}>{maskSecret(draft.curseforgeApiKey)}</span>
          ) : null}
          <span className={styles.keyHint}>
            Key 只保存在本机 launcher.json 中，不会上传到任何服务器；也可用环境变量
            RHINE_CURSEFORGE_API_KEY 注入，环境变量优先。
          </span>
        </Row>
      </Panel>

      {/* ---------------- storage info ---------------- */}
      <Panel caption="STORAGE" title="目录一览">
        <dl className={styles.dangerZone}>
          {paths ? (
            Object.entries(paths).map(([key, value]) => (
              <div className={styles.pathRow} key={key}>
                <span className="rh-caption">{key}</span>
                <span className={styles.pathValue}>{value}</span>
              </div>
            ))
          ) : (
            <p className={page.placeholder}>目录信息尚未加载。</p>
          )}
        </dl>
      </Panel>

      {dirty ? (
        <div className={styles.saveBar} role="status">
          <div className={styles.saveBar__text}>
            <span className={styles.saveBar__title}>有未保存的修改</span>
            <span className={styles.saveBar__hint}>
              将提交 {Object.keys(patch).length} 项：{Object.keys(patch).join('、')}
            </span>
          </div>
          <div className={styles.saveBar__actions}>
            <Button variant="quiet" onClick={reset}>放弃修改</Button>
            <Button variant="primary" loading={saving} onClick={() => void save()}>保存设置</Button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* row                                                                 */
/* ------------------------------------------------------------------ */

function Row({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className={page.formRow}>
      <div className={page.formRow__label}>
        <span className={page.formRow__title}>{title}</span>
        {hint ? <span className={page.formRow__hint}>{hint}</span> : null}
      </div>
      <div className={page.formRow__control}>{children}</div>
    </div>
  )
}

function themeLabel(theme: Settings['theme']): string {
  return THEMES.find((item) => item.key === theme)?.label ?? theme
}

function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause)
}
