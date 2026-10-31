import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import type { InstanceConfig, ModFile, TaskSnapshot } from '@rhine/core'

export type LauncherInstanceConfig = Pick<InstanceConfig, 'name' | 'gameVersion'> & Partial<Omit<InstanceConfig, 'name' | 'gameVersion'>>
export type LauncherInstancePatch = Partial<InstanceConfig>
export interface LauncherInstance {
  id: string
  name: string
  gameVersion: string
  loaders?: { kind: string; version?: string }[]
  path?: string
  memory?: { minMb: number; maxMb: number }
  javaPath?: string
  jvmArgs?: string[]
  gameArgs?: string[]
  window?: { width: number; height: number; fullscreen: boolean }
  icon?: string
  notes?: string
  revision?: number
  createdAt?: number
  lastLaunchedAt?: number
  playTimeMs?: number
  /** Compatibility projection; session changes do not replace the instance array. */
  running?: boolean
}
export interface LauncherSession {
  id: string
  instanceId: string
  status: string
  pid?: number
  accountName?: string
  startedAt?: number
  endedAt?: number
  exitCode?: number | null
  command?: string[]
  logFile?: string
}
export interface LauncherAccount { id: string; name: string; kind: string; uuid?: string; avatar?: string }
export type LauncherMod = ModFile
export type LauncherTask = TaskSnapshot
export interface LauncherIssue { code: string; message: string; status?: number }
export interface LauncherUnavailable { feature: string; status: string; code: string; message: string }
export type LauncherAction = 'launch' | 'stop' | 'create' | 'update' | 'account' | 'mods' | 'reveal'
export type LauncherConnection = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'disabled'
export interface LauncherSnapshot {
  status: 'loading' | 'ready' | 'error'
  error: LauncherIssue | null
  instances: LauncherInstance[]
  sessions: LauncherSession[]
  accounts: LauncherAccount[]
  selectedAccountId: string | null
  connection: LauncherConnection
  connectionError: LauncherIssue | null
  pending: Record<string, LauncherAction[]>
  errors: Record<string, LauncherIssue>
  actionPending: Partial<Record<LauncherAction, number>>
  actionErrors: Partial<Record<LauncherAction, LauncherIssue>>
  mods: Record<string, LauncherMod[]>
  tasks: LauncherTask[]
  unavailable: Record<string, LauncherUnavailable>
  app: { name?: string; version?: string; platform?: string; pid?: number } | null
  paths: Partial<Record<'root' | 'instances' | 'assets' | 'libraries' | 'java' | 'logs', string>> | null
}
export interface LauncherBootstrap {
  instances?: LauncherInstance[]
  sessions?: LauncherSession[]
  accounts?: LauncherAccount[]
  tasks?: LauncherTask[]
  app?: LauncherSnapshot['app']
  paths?: LauncherSnapshot['paths']
  unavailable: Record<string, LauncherUnavailable>
}
export const LAUNCHER_STATE_KEY = 'rhine.launcher.state'
export const LAUNCHER_ACCOUNT_STORAGE_KEY = 'rhine.launcher.selected-account'
type SelectionStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type InstanceListener = (instances: LauncherInstance[]) => void
interface ActionToken { action: LauncherAction; instanceId?: string; key: string }

function dictionary<T>(source?: Record<string, T>): Record<string, T> {
  return Object.assign(Object.create(null) as Record<string, T>, source)
}
function selectionStorage(): SelectionStorage | null {
  try { return typeof localStorage === 'undefined' ? null : localStorage } catch { return null }
}
export function launcherIssue(error: unknown): LauncherIssue {
  const source = error !== null && typeof error === 'object' ? error as Record<string, unknown> : {}
  return {
    code: typeof source.code === 'string' && source.code ? source.code : 'UNKNOWN',
    message: typeof source.message === 'string' && source.message ? source.message : typeof error === 'string' && error ? error : '未知错误（UNKNOWN）',
    ...(typeof source.status === 'number' && Number.isFinite(source.status) ? { status: source.status } : {}),
  }
}
export function issueError(issue: LauncherIssue): FeatureError { return new FeatureError(issue.code, issue.message, issue.status ?? 503) }
export function activeSession(session: LauncherSession): boolean { return session.status === 'running' || session.status === 'starting' }

/** Shared data only. All I/O and capability lifecycles belong to individual features. */
export class LauncherState {
  snapshot: LauncherSnapshot
  bootstrapped = false
  closed = false
  bootstrapFlight?: Promise<void>
  private instanceListeners = new Set<InstanceListener>()
  private statusListeners = new Set<() => void>()
  private actionTokens = new Set<ActionToken>()
  private hasInstanceSnapshot = false
  private revision = 0
  private instanceRevisions = new Map<string, number>()
  private sessionRevisions = new Map<string, number>()
  private accountRevisions = new Map<string, number>()
  private taskRevisions = new Map<string, number>()
  constructor(private storage: SelectionStorage | null = selectionStorage()) {
    let selectedAccountId: string | null = null
    try { selectedAccountId = storage?.getItem(LAUNCHER_ACCOUNT_STORAGE_KEY) || null } catch { /* Storage may be denied. */ }
    this.snapshot = {
      status: 'loading', error: null, instances: [], sessions: [], accounts: [], selectedAccountId,
      connection: 'disconnected', connectionError: null, pending: dictionary(), errors: dictionary(),
      actionPending: {}, actionErrors: {}, mods: dictionary(), tasks: [], unavailable: dictionary(), app: null, paths: null,
    }
  }
  subscribeInstances(listener: InstanceListener): () => void {
    this.instanceListeners.add(listener)
    if (this.hasInstanceSnapshot || this.snapshot.instances.length) this.notify(() => listener(this.snapshot.instances))
    return () => { this.instanceListeners.delete(listener) }
  }
  subscribeStatus(listener: () => void): () => void {
    this.statusListeners.add(listener)
    return () => { this.statusListeners.delete(listener) }
  }
  patch(patch: Partial<LauncherSnapshot>): void {
    if (this.closed) return
    this.snapshot = { ...this.snapshot, ...patch }
    this.publishStatus()
  }
  setConnection(connection: LauncherConnection, connectionError: LauncherIssue | null = null): void {
    if (this.snapshot.connection === connection && this.snapshot.connectionError === connectionError) return
    this.patch({ connection, connectionError })
  }
  failBootstrap(error: unknown): void { this.patch({ status: 'error', error: launcherIssue(error) }) }
  captureRevision(): number { return this.revision }
  applyBootstrap(next: LauncherBootstrap, since = this.revision): void {
    if (this.closed) return
    const previous = this.snapshot.instances
    const firstInstances = next.instances !== undefined && !this.hasInstanceSnapshot
    if (next.instances !== undefined) this.hasInstanceSnapshot = true
    const instances = next.instances ? this.reconcileInstances(this.mergeSince(next.instances, previous, this.instanceRevisions, since)) : previous
    const accounts = next.accounts ? this.mergeSince(next.accounts, this.snapshot.accounts, this.accountRevisions, since) : this.snapshot.accounts
    const sessions = next.sessions ? this.mergeSince(next.sessions, this.snapshot.sessions, this.sessionRevisions, since).map(session => this.preserveTerminal(session)) : this.snapshot.sessions
    const tasks = next.tasks ? this.mergeSince(next.tasks, this.snapshot.tasks, this.taskRevisions, since).slice(0, 100) : this.snapshot.tasks
    const unavailable = next.unavailable
    const first = Object.values(unavailable)[0]
    const error = first ? { code: first.code, message: first.message, status: 503 } : null
    this.snapshot = {
      ...this.snapshot, ...next, instances, sessions, accounts, tasks, unavailable,
      selectedAccountId: next.accounts ? this.validSelection(accounts) : this.snapshot.selectedAccountId,
      status: error ? 'error' : 'ready', error,
    }
    if (!error) this.bootstrapped = true
    this.syncRunning()
    if (instances !== previous || firstInstances) this.publishInstances()
    this.publishStatus()
  }
  upsertInstance(instance: LauncherInstance): void {
    if (this.closed) return
    this.hasInstanceSnapshot = true
    this.instanceRevisions.set(instance.id, ++this.revision)
    const index = this.snapshot.instances.findIndex(item => item.id === instance.id)
    const next = this.snapshot.instances.slice()
    if (index < 0) next.push(instance)
    else next[index] = instance
    const instances = this.reconcileInstances(next)
    if (instances === this.snapshot.instances) return
    this.snapshot = { ...this.snapshot, instances }
    this.syncRunning()
    this.publishInstances()
    this.publishStatus()
  }
  removeInstance(id: string): void {
    if (this.closed) return
    this.instanceRevisions.set(id, ++this.revision)
    const instances = this.snapshot.instances.filter(item => item.id !== id)
    if (instances.length === this.snapshot.instances.length) return
    this.snapshot = { ...this.snapshot, instances }
    this.publishInstances()
    this.publishStatus()
  }
  upsertSession(session: LauncherSession): void {
    if (this.closed) return
    this.sessionRevisions.set(session.id, ++this.revision)
    session = this.preserveTerminal(session)
    this.snapshot = { ...this.snapshot, sessions: [session, ...this.snapshot.sessions.filter(item => item.id !== session.id)] }
    this.syncRunning()
    this.publishStatus()
  }
  sessionFor(instanceId: string): LauncherSession | undefined {
    return this.snapshot.sessions.find(item => item.instanceId === instanceId && activeSession(item))
  }
  upsertAccount(account: LauncherAccount): void {
    if (this.closed) return
    this.accountRevisions.set(account.id, ++this.revision)
    const accounts = [...this.snapshot.accounts.filter(item => item.id !== account.id), account]
    this.patch({ accounts, selectedAccountId: this.validSelection(accounts) })
  }
  setSelectedAccount(id: string): void {
    this.requireAvailable('accounts')
    if (!this.snapshot.accounts.some(account => account.id === id)) throw new FeatureError('ACCOUNT_NOT_FOUND', '所选账号不存在，请重新选择账号', 404)
    this.persistSelection(id)
    this.patch({ selectedAccountId: id })
  }
  selectedAccount(): LauncherAccount {
    this.requireAvailable('accounts')
    const id = this.validSelection(this.snapshot.accounts)
    if (id !== this.snapshot.selectedAccountId) this.patch({ selectedAccountId: id })
    const account = this.snapshot.accounts.find(item => item.id === id)
    if (!account) throw new FeatureError('ACCOUNT_REQUIRED', '还没有账号，请先添加离线账号或选择已有账号', 400)
    return account
  }
  requireAvailable(field: string): void {
    const unavailable = this.snapshot.unavailable[field]
    if (unavailable) throw issueError({ code: unavailable.code, message: unavailable.message, status: 503 })
  }
  startAction(action: LauncherAction, instanceId?: string): ActionToken {
    if (this.closed) throw new FeatureError('HOST_DISPOSED', '启动器连接已关闭', 409)
    const key = JSON.stringify([action, instanceId])
    if ([...this.actionTokens].some(token => token.key === key)) throw new FeatureError('ACTION_PENDING', '该操作正在进行中', 409)
    const token = { action, instanceId, key }
    this.actionTokens.add(token)
    const pending = dictionary(this.snapshot.pending), errors = dictionary(this.snapshot.errors)
    const actionPending = { ...this.snapshot.actionPending, [action]: (this.snapshot.actionPending[action] ?? 0) + 1 }
    const actionErrors = { ...this.snapshot.actionErrors }
    delete actionErrors[action]
    if (instanceId !== undefined) { pending[instanceId] = [...(pending[instanceId] ?? []), action]; delete errors[instanceId] }
    this.patch({ pending, errors, actionPending, actionErrors })
    return token
  }
  finishAction(token: ActionToken, error?: unknown): void {
    if (!this.actionTokens.delete(token)) return
    const pending = dictionary(this.snapshot.pending), errors = dictionary(this.snapshot.errors)
    const actionPending = { ...this.snapshot.actionPending, [token.action]: Math.max(0, (this.snapshot.actionPending[token.action] ?? 1) - 1) }
    const actionErrors = { ...this.snapshot.actionErrors }
    if (token.instanceId !== undefined) {
      const remaining = (pending[token.instanceId] ?? []).filter(action => action !== token.action)
      if (remaining.length) pending[token.instanceId] = remaining
      else delete pending[token.instanceId]
    }
    if (error !== undefined) {
      actionErrors[token.action] = launcherIssue(error)
      if (token.instanceId !== undefined) errors[token.instanceId] = actionErrors[token.action]!
    } else {
      delete actionErrors[token.action]
      if (token.instanceId !== undefined) delete errors[token.instanceId]
    }
    this.patch({ pending, errors, actionPending, actionErrors })
  }
  recordActionError(action: LauncherAction, instanceId: string | undefined, error: unknown): void {
    const issue = launcherIssue(error)
    const previous = this.snapshot.actionErrors[action]
    if (previous?.code === issue.code && previous.message === issue.message && (instanceId === undefined || this.snapshot.errors[instanceId]?.message === issue.message)) return
    const errors = dictionary(this.snapshot.errors)
    if (instanceId !== undefined) errors[instanceId] = issue
    this.patch({ errors, actionErrors: { ...this.snapshot.actionErrors, [action]: issue } })
  }
  setMods(id: string, mods: LauncherMod[]): void { const next = dictionary(this.snapshot.mods); next[id] = mods; this.patch({ mods: next }) }
  upsertTask(task: LauncherTask): void {
    if (this.closed) return
    this.taskRevisions.set(task.id, ++this.revision)
    this.patch({ tasks: [task, ...this.snapshot.tasks.filter(item => item.id !== task.id)].slice(0, 100) })
  }
  dispose(): void {
    this.setConnection('disabled')
    this.closed = true
    this.instanceListeners.clear()
    this.statusListeners.clear()
  }
  private validSelection(accounts: LauncherAccount[]): string | null {
    const saved = this.snapshot.selectedAccountId
    const id = accounts.some(account => account.id === saved) ? saved : accounts[0]?.id ?? null
    if (id !== saved) this.persistSelection(id)
    return id
  }
  private persistSelection(id: string | null): void {
    try { if (id === null) this.storage?.removeItem(LAUNCHER_ACCOUNT_STORAGE_KEY); else this.storage?.setItem(LAUNCHER_ACCOUNT_STORAGE_KEY, id) } catch { /* Selection still works in memory. */ }
  }
  private preserveTerminal(session: LauncherSession): LauncherSession {
    const previous = this.snapshot.sessions.find(item => item.id === session.id)
    // An exit event can beat the HTTP launch response. Never resurrect that session.
    return previous && ['exited', 'crashed', 'stopped'].includes(previous.status) && activeSession(session) ? previous : session
  }
  private mergeSince<T extends { id: string }>(incoming: T[], current: T[], revisions: Map<string, number>, since: number): T[] {
    const merged = new Map(incoming.map(item => [item.id, item]))
    const known = new Map(current.map(item => [item.id, item]))
    // HTTP and WS are independent. A late snapshot must not roll back newer events/actions.
    for (const [id, revision] of revisions) if (revision > since) {
      const value = known.get(id)
      if (value) merged.set(id, value)
      else merged.delete(id)
    }
    return [...merged.values()]
  }
  private reconcileInstances(next: LauncherInstance[]): LauncherInstance[] {
    const previous = this.snapshot.instances
    const content = (value: LauncherInstance) => JSON.stringify({ ...value, running: undefined })
    const reconciled = next.map(item => {
      const known = previous.find(value => value.id === item.id)
      return known && content(known) === content(item) ? known : item
    })
    return reconciled.length === previous.length && reconciled.every((item, index) => item === previous[index]) ? previous : reconciled
  }
  private syncRunning(): void {
    const running = new Set(this.snapshot.sessions.filter(activeSession).map(session => session.instanceId))
    for (const instance of this.snapshot.instances) instance.running = running.has(instance.id)
  }
  private publishInstances(): void { for (const listener of [...this.instanceListeners]) this.notify(() => listener(this.snapshot.instances)) }
  private publishStatus(): void { for (const listener of [...this.statusListeners]) this.notify(listener) }
  private notify(callback: () => void): void { try { callback() } catch { /* A consumer cannot break bridge state or cleanup. */ } }
}
export function launcherState(env: FeatureEnvironment): LauncherState { return env.state(LAUNCHER_STATE_KEY, () => new LauncherState(), state => state.dispose()) }
