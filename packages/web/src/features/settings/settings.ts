/**
 * Pure helpers for the settings page: defaults, validation and diffing.
 *
 * The backend owns persistence; this module only decides what the form shows,
 * what counts as invalid and which patch should be sent.
 */
import type { Settings } from '@rhine/core'

/** Field keys the music of the settings form manages. */
export type SettingsField = keyof Settings

/** Validation errors keyed by a dotted path, e.g. `proxy.port`. */
export type SettingsErrors = Record<string, string>

/** Nested settings the form edits as one row. */
export const MIRROR_FIELDS: { key: keyof Settings['mirrors']; label: string; hint?: string }[] = [
  { key: 'versionManifest', label: '版本清单', hint: 'version_manifest_v2.json 所在地址' },
  { key: 'launcherMeta', label: '启动器元数据', hint: 'piston-meta 根地址' },
  { key: 'assets', label: '资源文件', hint: 'assets 对象存储根地址' },
  { key: 'maven', label: 'Maven 仓库', hint: 'libraries 下载根地址' },
  { key: 'fabric', label: 'Fabric', hint: 'Fabric meta API' },
  { key: 'forge', label: 'Forge', hint: 'Forge maven / promotions' },
  { key: 'neoforge', label: 'NeoForge', hint: 'NeoForge maven' },
  { key: 'quilt', label: 'Quilt', hint: 'Quilt meta API' },
  { key: 'modrinth', label: 'Modrinth', hint: 'Modrinth v2 API' },
  { key: 'curseforge', label: 'CurseForge', hint: 'CurseForge v1 API' },
]

/** Download source presets shown as a two-way switch. */
export const DOWNLOAD_SOURCES: { key: Settings['downloadSource']; label: string; hint: string }[] = [
  { key: 'official', label: '官方源', hint: '直接连接 Mojang / 加载器官方服务器' },
  { key: 'mirror', label: '镜像源', hint: '使用 BMCLAPI 等国内镜像加速下载' },
]

/** Theme presets; the value is written to `html[data-theme]`. */
export const THEMES: { key: Settings['theme']; label: string; hint: string }[] = [
  { key: 'archive', label: '档案', hint: '暖灰白纸面 + 暖杏金信号（默认）' },
  { key: 'midnight', label: '午夜', hint: '深色底，夜间启动' },
  { key: 'light', label: '明亮', hint: '纯白高对比' },
]

/** Language presets. */
export const LANGUAGES: { key: Settings['language']; label: string }[] = [
  { key: 'zh-CN', label: '简体中文' },
  { key: 'en-US', label: 'English' },
]

/** Numeric bounds so the form cannot produce a launcher-breaking config. */
export const LIMITS = {
  concurrency: { min: 1, max: 64 },
  keepLogs: { min: 1, max: 200 },
  memoryMb: { min: 512, max: 65536 },
  port: { min: 1, max: 65535 },
} as const

/**
 * Validate the editable settings and return a map of field errors.
 *
 * @param value — draft settings from the form.
 * @returns an empty object when everything is acceptable.
 */
export function validateSettings(value: Settings): SettingsErrors {
  const errors: SettingsErrors = {}

  if (!LANGUAGES.some((item) => item.key === value.language)) {
    errors.language = '请选择受支持的语言'
  }
  if (!THEMES.some((item) => item.key === value.theme)) {
    errors.theme = '请选择受支持的主题'
  }

  const concurrency = Number(value.concurrency)
  if (!Number.isInteger(concurrency) || concurrency < LIMITS.concurrency.min || concurrency > LIMITS.concurrency.max) {
    errors.concurrency = `并发数需为 ${LIMITS.concurrency.min}-${LIMITS.concurrency.max} 的整数`
  }

  const keepLogs = Number(value.keepLogs)
  if (!Number.isInteger(keepLogs) || keepLogs < LIMITS.keepLogs.min || keepLogs > LIMITS.keepLogs.max) {
    errors.keepLogs = `保留日志数需为 ${LIMITS.keepLogs.min}-${LIMITS.keepLogs.max} 的整数`
  }

  if (value.dataDir !== null && value.dataDir !== undefined) {
    if (typeof value.dataDir !== 'string' || !value.dataDir.trim()) {
      errors.dataDir = '数据目录不能为空，如需恢复默认请留空'
    }
  }

  for (const field of MIRROR_FIELDS) {
    const url = value.mirrors?.[field.key] ?? ''
    if (!url.trim()) {
      errors['mirrors.' + field.key] = `${field.label}地址不能为空`
      continue
    }
    if (!isHttpUrl(url)) errors['mirrors.' + field.key] = '请填写 http(s) 开头的完整地址'
  }

  if (value.proxy?.enabled) {
    if (!value.proxy.host?.trim()) errors['proxy.host'] = '请填写代理主机'
    const port = Number(value.proxy.port)
    if (!Number.isInteger(port) || port < LIMITS.port.min || port > LIMITS.port.max) {
      errors['proxy.port'] = `端口需为 ${LIMITS.port.min}-${LIMITS.port.max} 的整数`
    }
  }

  const key = value.curseforgeApiKey?.trim()
  if (key && !/^[A-Za-z0-9$._-]{8,128}$/.test(key)) {
    errors.curseforgeApiKey = 'CurseForge Key 格式不正确'
  }

  return errors
}

/** True when the string is an absolute http(s) URL. */
export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

/** True when no validation error is present. */
export function isValidSettings(value: Settings): boolean {
  return Object.keys(validateSettings(value)).length === 0
}

/**
 * Compute a minimal patch between the persisted settings and the draft.
 *
 * Only changed keys are sent so the backend never rewrites unrelated sections
 * (important because the backend emits a settings event on every update).
 */
export function diffSettings(original: Settings, draft: Settings): Partial<Settings> {
  const patch: Record<string, unknown> = {}
  const record = patch as Record<string, unknown>
  const originalRecord = original as unknown as Record<string, unknown>
  const draftRecord = draft as unknown as Record<string, unknown>

  for (const key of Object.keys(draftRecord) as SettingsField[]) {
    const before = originalRecord[key as string]
    const after = draftRecord[key as string]
    if (key === 'mirrors' || key === 'proxy') {
      if (stableStringify(before) !== stableStringify(after)) record[key] = after
      continue
    }
    if (before !== after) record[key] = after
  }
  return patch as Partial<Settings>
}

/** JSON stringify with sorted keys, used for deep equality of nested objects. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(stableStringify).join(',') + ']'
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => item !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
  return '{' + entries.map(([key, item]) => JSON.stringify(key) + ':' + stableStringify(item)).join(',') + '}'
}

/**
 * Apply a numeric field's bounds while the user types.
 *
 * @returns the clamped integer, or `null` when the input is not a number yet.
 */
export function clampInt(raw: string, min: number, max: number): number | null {
  // An empty box means "the user is still typing", not "zero": keep the draft
  // untouched instead of snapping the field to the minimum on every keystroke.
  if (!raw.trim()) return null
  const value = Number(raw)
  if (!Number.isFinite(value)) return null
  return Math.min(max, Math.max(min, Math.round(value)))
}

/** CurseForge key is masked in the UI until the user reveals it. */
export function maskSecret(value: string | undefined): string {
  if (!value) return ''
  if (value.length <= 8) return value.replace(/./g, '•')
  return value.slice(0, 4) + '•'.repeat(Math.min(16, value.length - 8)) + value.slice(-4)
}

/** Clone settings deeply so the form never mutates the store. */
export function cloneSettings(value: Settings): Settings {
  return JSON.parse(JSON.stringify(value)) as Settings
}
