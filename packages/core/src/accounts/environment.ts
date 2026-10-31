import type { FeatureEnvironment } from '@rhine/plugin-api'
import type { RhPaths } from '../contracts.ts'
import { AccountRepository, createAccountsState, type AccountsState } from './repository.ts'
import { cancelMicrosoftFlows } from './flows.ts'

export const ACCOUNT_READ_DEPENDS = ['paths.get', 'storage.read.sync'] as const
export const ACCOUNT_WRITE_DEPENDS = [...ACCOUNT_READ_DEPENDS, 'storage.write'] as const

export function accountsState(env: FeatureEnvironment): AccountsState {
  return env.state('engine.accounts', createAccountsState, state => cancelMicrosoftFlows(state))
}
export function accountRepository(env: FeatureEnvironment): AccountRepository {
  return new AccountRepository(accountsState(env), {
    root: () => env.use<RhPaths>('paths.get').root,
    readSync: (file, fallback) => env.use('storage.read.sync', { file, fallback }),
    write: (file, value) => env.use<Promise<void>>('storage.write', { file, value }),
  })
}
