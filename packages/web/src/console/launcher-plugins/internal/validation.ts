import { FeatureError } from '@rhine/plugin-api'
import { launcherIssue, type LauncherAccount, type LauncherBootstrap, type LauncherInstance, type LauncherMod, type LauncherSession, type LauncherTask, type LauncherUnavailable } from '../../launcher-state'

type ObjectValue = Record<string, unknown>
export function object(value: unknown, label = '响应'): ObjectValue {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) invalid(label)
  return value as ObjectValue
}
export function invalid(label: string): never { throw new FeatureError('INVALID_RESPONSE', label + '格式无效（UNKNOWN），请刷新后重试', 502) }
export function text(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value.trim()) invalid(label)
  return value
}
function optionalText(value: unknown, label: string): string | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'string') invalid(label)
  return value
}
function number(value: unknown, label: string): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) invalid(label)
  return value
}
function optionalNumber(value: unknown, label: string): number | undefined { return value === undefined ? undefined : number(value, label) }
function bool(value: unknown, label: string): boolean { if (typeof value !== 'boolean') invalid(label); return value }
export function list<T>(value: unknown, parse: (item: unknown) => T, label: string): T[] {
  if (!Array.isArray(value)) invalid(label)
  return value.map(parse)
}
function strings(value: unknown, label: string): string[] { return list(value, item => { if (typeof item !== 'string') invalid(label); return item }, label) }
function unique<T extends { id: string }>(items: T[], label: string): T[] {
  if (new Set(items.map(item => item.id)).size !== items.length) invalid(label + '包含重复标识')
  return items
}
export function instance(value: unknown): LauncherInstance {
  const data = object(value, '实例')
  const result: LauncherInstance = { id: text(data.id, '实例 id'), name: text(data.name, '实例名称'), gameVersion: text(data.gameVersion, '游戏版本') }
  if (data.loaders !== undefined) result.loaders = list(data.loaders, value => { const item = object(value, '加载器'); return { kind: text(item.kind, '加载器类型'), version: optionalText(item.version, '加载器版本') } }, '加载器列表')
  for (const key of ['path', 'javaPath', 'icon', 'notes'] as const) if (data[key] !== undefined) result[key] = optionalText(data[key], key)
  for (const key of ['revision', 'createdAt', 'lastLaunchedAt', 'playTimeMs'] as const) if (data[key] !== undefined) result[key] = number(data[key], key)
  if (data.memory !== undefined) { const memory = object(data.memory, '内存'); result.memory = { minMb: number(memory.minMb, 'minMb'), maxMb: number(memory.maxMb, 'maxMb') } }
  if (data.jvmArgs !== undefined) result.jvmArgs = strings(data.jvmArgs, 'jvmArgs')
  if (data.gameArgs !== undefined) result.gameArgs = strings(data.gameArgs, 'gameArgs')
  if (data.window !== undefined) { const window = object(data.window, '窗口'); result.window = { width: number(window.width, '窗口宽度'), height: number(window.height, '窗口高度'), fullscreen: bool(window.fullscreen, 'fullscreen') } }
  return result
}
export function session(value: unknown): LauncherSession {
  const data = object(value, '启动会话')
  const result: LauncherSession = { id: text(data.id, '会话 id'), instanceId: text(data.instanceId, '实例 id'), status: text(data.status, '会话状态') }
  for (const key of ['pid', 'startedAt', 'endedAt'] as const) if (data[key] !== undefined) result[key] = number(data[key], key)
  for (const key of ['accountName', 'logFile'] as const) if (data[key] !== undefined) result[key] = optionalText(data[key], key)
  if (data.exitCode !== undefined) result.exitCode = data.exitCode === null ? null : number(data.exitCode, 'exitCode')
  if (data.command !== undefined) result.command = strings(data.command, 'command')
  return result
}
export function account(value: unknown): LauncherAccount {
  const data = object(value, '账号')
  // Tokens and other authentication secrets are deliberately not retained in this UI store.
  return { id: text(data.id, '账号 id'), name: text(data.name, '账号名称'), kind: text(data.kind, '账号类型'), uuid: optionalText(data.uuid, 'uuid'), avatar: optionalText(data.avatar, 'avatar') }
}
export function mod(value: unknown): LauncherMod {
  const data = object(value, '模组')
  const result: LauncherMod = { path: text(data.path, '模组路径'), name: text(data.name, '模组名称'), diskName: text(data.diskName, '模组文件名'), enabled: bool(data.enabled, '模组启用状态'), isDirectory: bool(data.isDirectory, 'isDirectory'), size: number(data.size, '模组大小'), modifiedAt: number(data.modifiedAt, '模组修改时间') }
  if (data.meta !== undefined) {
    const meta = object(data.meta, '模组元数据'), resultMeta: NonNullable<LauncherMod['meta']> = {}
    for (const key of ['id', 'name', 'version', 'description', 'icon'] as const) if (meta[key] !== undefined) resultMeta[key] = optionalText(meta[key], key)
    if (meta.authors !== undefined) resultMeta.authors = strings(meta.authors, '模组作者')
    if (meta.gameVersions !== undefined) resultMeta.gameVersions = strings(meta.gameVersions, '模组游戏版本')
    if (meta.loader !== undefined) resultMeta.loader = text(meta.loader, '模组加载器') as NonNullable<LauncherMod['meta']>['loader']
    if (meta.dependencies !== undefined) resultMeta.dependencies = list(meta.dependencies, value => { const dep = object(value, '模组依赖'); return { id: text(dep.id, '依赖 id'), versionRange: optionalText(dep.versionRange, 'versionRange'), ...(dep.optional === undefined ? {} : { optional: bool(dep.optional, 'optional') }) } }, '模组依赖')
    result.meta = resultMeta
  }
  return result
}
export function task(value: unknown): LauncherTask {
  const data = object(value, '任务'), progress = object(data.progress, '任务进度')
  const stage = text(progress.stage, '任务阶段')
  if (!['resolve', 'download', 'verify', 'extract', 'write', 'done'].includes(stage)) invalid('任务阶段')
  const status = text(data.status, '任务状态')
  if (!['queued', 'running', 'succeeded', 'failed', 'cancelled'].includes(status)) invalid('任务状态')
  return {
    id: text(data.id, '任务 id'), kind: text(data.kind, '任务类型'), title: text(data.title, '任务标题'), status: status as LauncherTask['status'],
    progress: { value: number(progress.value, '进度'), stage: stage as LauncherTask['progress']['stage'], current: number(progress.current, 'current'), total: number(progress.total, 'total'), message: optionalText(progress.message, '进度消息') },
    logs: list(data.logs, value => { const log = object(value, '任务日志'); const level = text(log.level, '日志级别'); if (!['debug', 'info', 'warn', 'error'].includes(level)) invalid('日志级别'); return { time: number(log.time, '日志时间'), level: level as LauncherTask['logs'][number]['level'], message: typeof log.message === 'string' ? log.message : invalid('日志内容') } }, '任务日志'),
    createdAt: number(data.createdAt, '任务创建时间'), finishedAt: optionalNumber(data.finishedAt, '任务结束时间'), error: optionalText(data.error, '任务错误'),
  }
}
export function success(value: unknown): void { if (object(value).ok !== true) invalid('操作确认') }

/** Validate sections independently: unavailable/malformed lists never overwrite known good data. */
export function bootstrap(value: unknown): LauncherBootstrap {
  const data = object(value, '启动快照')
  const unavailable: Record<string, LauncherUnavailable> = Object.create(null)
  if (data.unavailable !== undefined) for (const [field, value] of Object.entries(object(data.unavailable, '不可用功能列表'))) {
    const detail = object(value, '不可用功能')
    const feature = typeof detail.feature === 'string' && detail.feature ? detail.feature : field
    unavailable[field] = { feature, status: typeof detail.status === 'string' ? detail.status : 'unknown', code: typeof detail.code === 'string' && detail.code ? detail.code : 'PLUGIN_UNAVAILABLE', message: typeof detail.message === 'string' && detail.message ? detail.message : feature + ' 暂不可用（UNKNOWN）' }
  }
  const result: LauncherBootstrap = { unavailable }
  const section = <T>(field: string, feature: string, parse: () => T): T | undefined => {
    if (unavailable[field]) return undefined
    try { return parse() } catch (error) { const issue = launcherIssue(error); unavailable[field] = { feature, status: 'invalid', code: issue.code, message: issue.message }; return undefined }
  }
  const instances = section('instances', 'instance.list', () => unique(list(data.instances, instance, '实例列表'), '实例列表'))
  const sessions = section('sessions', 'session.list', () => unique(list(data.sessions, session, '会话列表'), '会话列表'))
  const accounts = section('accounts', 'account.list', () => unique(list(data.accounts, account, '账号列表'), '账号列表'))
  if (instances) result.instances = instances
  if (sessions) result.sessions = sessions
  if (accounts) result.accounts = accounts
  if (data.tasks !== undefined) { const tasks = section('tasks', 'task.list', () => unique(list(data.tasks, task, '任务列表'), '任务列表')); if (tasks) result.tasks = tasks }
  if (data.app !== undefined) {
    const app = section('app', 'bootstrap', () => { const app = object(data.app, '启动器信息'); return { name: optionalText(app.name, '应用名称'), version: optionalText(app.version, '应用版本'), platform: optionalText(app.platform, '系统平台'), pid: optionalNumber(app.pid, '进程 id') } })
    if (app !== undefined) result.app = app
  }
  if (data.paths !== undefined) {
    const paths = section('paths', 'paths.get', () => { const paths = object(data.paths, '目录信息'); const result: NonNullable<LauncherBootstrap['paths']> = {}; for (const key of ['root', 'instances', 'assets', 'libraries', 'java', 'logs'] as const) if (paths[key] !== undefined) result[key] = optionalText(paths[key], key); return result })
    if (paths !== undefined) result.paths = paths
  }
  return result
}
