import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { Account } from '../types.ts'
import { AccountError } from './errors.ts'

export function accountId(input: { id: string }): string {
  if (!input || typeof input.id !== 'string' || !input.id || input.id.length > 256) throw new AccountError('账号 ID 无效', 'INVALID_ACCOUNT_ID')
  return input.id
}
export function requireAccount(env: FeatureEnvironment, id: string): Account {
  const account = env.use<Account | undefined>('account.get', { id })
  if (!account) throw new AccountError('账号不存在：' + id, 'ACCOUNT_NOT_FOUND')
  return account
}
