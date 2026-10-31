import { join } from 'node:path'
import type { Account } from '../types.ts'
import { AccountError } from './errors.ts'
import type { PendingMicrosoftFlow } from './flows.ts'

export const ACCOUNT_FILE = 'accounts.json'
export const OFFLINE_NAME_PATTERN = /^[A-Za-z0-9_]{1,16}$/

/** Only cache/flow data is shared. No service or feature gets registered by this repository. */
export interface AccountsState {
  file?: string
  accounts: Account[]
  writes: Promise<void>
  flows: Map<string, PendingMicrosoftFlow>
  latestFlowId?: string
  terminalFlows: Map<string, 'EXPIRED_TOKEN' | 'FLOW_CANCELLED'>
}
export function createAccountsState(): AccountsState {
  return { accounts: [], writes: Promise.resolve(), flows: new Map(), terminalFlows: new Map() }
}
export interface AccountStorage {
  root(): string
  readSync(file: string, fallback: unknown): unknown
  write(file: string, value: unknown): Promise<void>
}

/** Pure persistence adapter. Authentication actions live in their own descriptors. */
export class AccountRepository {
  constructor(readonly state: AccountsState, private readonly storage: AccountStorage) {}

  list(): Account[] { this.load(); return this.state.accounts.map(cloneAccount) }
  get(id: string): Account | undefined { this.load(); const account = this.state.accounts.find(a => a.id === id); return account && cloneAccount(account) }
  require(id: string): Account {
    const account = this.get(id)
    if (!account) throw new AccountError('账号不存在：' + id, 'ACCOUNT_NOT_FOUND')
    return account
  }
  upsert(account: Account): Promise<Account> {
    return this.mutate(async file => {
      const next = this.state.accounts.map(cloneAccount)
      const index = next.findIndex(a => a.id === account.id)
      if (index < 0) next.push(cloneAccount(account)); else next[index] = cloneAccount(account)
      await this.storage.write(file, next)
      this.state.accounts = next
      return cloneAccount(account)
    })
  }
  remove(id: string): Promise<void> {
    return this.mutate(async file => {
      if (!this.state.accounts.some(a => a.id === id)) throw new AccountError('账号不存在：' + id, 'ACCOUNT_NOT_FOUND')
      const next = this.state.accounts.filter(a => a.id !== id).map(cloneAccount)
      await this.storage.write(file, next)
      this.state.accounts = next
    })
  }
  private load(): string {
    const file = join(this.storage.root(), ACCOUNT_FILE)
    if (this.state.file === file) return file
    const stored = this.storage.readSync(file, [])
    if (!Array.isArray(stored)) throw new AccountError('账号存储不是有效数组，未覆盖原文件', 'ACCOUNT_STORAGE_INVALID')
    // Keep authlib-injector as well as Microsoft/offline identities on reload.
    const accounts = stored.filter(isAccount).map(cloneAccount)
    this.state.accounts = accounts
    this.state.file = file
    return file
  }
  private mutate<T>(body: (file: string) => Promise<T>): Promise<T> {
    const run = this.state.writes.then(() => body(this.load()))
    // Keep the serial queue usable after an error; the caller's promise still rejects.
    this.state.writes = run.then(() => undefined, () => undefined)
    return run
  }
}

export function isAccount(value: unknown): value is Account {
  if (!value || typeof value !== 'object') return false
  const account = value as Partial<Account>
  return typeof account.id === 'string' && !!account.id
    && ['offline', 'microsoft', 'authlib-injector'].includes(account.kind ?? '')
    && typeof account.name === 'string' && !!account.name
    && typeof account.uuid === 'string' && !!account.uuid
}
export function cloneAccount(account: Account): Account {
  const clean = { ...account } as Account & Record<string, unknown>
  // Never write a password, even when upgrading data produced by another client.
  delete clean.password
  delete clean.clientSecret
  return clean
}
export function redactAccount(account: Account): Omit<Account, 'accessToken' | 'refreshToken' | 'clientToken'> {
  const { accessToken: _access, refreshToken: _refresh, clientToken: _client, ...safe } = cloneAccount(account)
  return safe
}
