import { describe, expect, it } from 'vitest'
import type { Account, DeviceCodeFlow } from '@rhine/core'
import {
  accountKindLabel, avatarInitial, avatarUrl, countdown, decidePoll, formatUserCode,
  isValidOfflineName, needsRefresh, remainingMs, shortUuid, sortAccounts, validateOfflineName,
} from '../src/features/accounts/accounts.ts'

function account(partial: Partial<Account> = {}): Account {
  return { id: 'a1', kind: 'offline', name: 'Steve', uuid: '00000000-0000-3000-8000-000000000000', ...partial }
}

function flow(partial: Partial<DeviceCodeFlow> = {}): DeviceCodeFlow {
  return {
    userCode: 'ABCD1234',
    verificationUri: 'https://microsoft.com/link',
    deviceCode: 'dc',
    intervalMs: 5000,
    expiresAt: Date.now() + 900_000,
    ...partial,
  }
}

describe('validateOfflineName', () => {
  it('accepts valid names', () => {
    expect(validateOfflineName('Erin')).toBeUndefined()
    expect(validateOfflineName('player_01')).toBeUndefined()
    expect(isValidOfflineName('  Erin  ')).toBe(true)
  })

  it('rejects empty, short and long names', () => {
    expect(validateOfflineName('')).toBe('请输入用户名')
    expect(validateOfflineName('ab')).toBe('用户名至少 3 个字符')
    expect(validateOfflineName('a'.repeat(17))).toBe('用户名最多 16 个字符')
  })

  it('rejects characters outside the profile alphabet', () => {
    expect(validateOfflineName('bad name')).toContain('字母、数字和下划线')
    expect(validateOfflineName('很长的中文名')).toContain('字母、数字和下划线')
    expect(validateOfflineName('a-b')).toContain('字母、数字和下划线')
  })

  it('rejects reserved names case-insensitively', () => {
    expect(validateOfflineName('Steve')).toContain('保留名称')
    expect(validateOfflineName('ADMIN')).toContain('保留名称')
  })
})

describe('avatar helpers', () => {
  it('uses an explicit avatar first', () => {
    expect(avatarUrl(account({ avatar: 'data:image/png;base64,x' }))).toBe('data:image/png;base64,x')
  })

  it('builds a crafatar URL for Microsoft accounts', () => {
    const url = avatarUrl(account({ kind: 'microsoft', uuid: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee' }))
    expect(url).toContain('crafatar.com/avatars/aaaaaaaabbbbccccddddeeeeeeeeeeee')
  })

  it('has no remote avatar for offline accounts', () => {
    expect(avatarUrl(account())).toBeUndefined()
  })

  it('renders the first letter as the fallback initial', () => {
    expect(avatarInitial(account({ name: 'erin' }))).toBe('E')
    expect(avatarInitial(account({ name: '' }))).toBe('?')
  })

  it('labels the account kind', () => {
    expect(accountKindLabel(account())).toBe('离线')
    expect(accountKindLabel(account({ kind: 'microsoft' }))).toBe('Microsoft')
  })
})

describe('needsRefresh', () => {
  const now = 1_000_000

  it('never refreshes offline accounts', () => {
    expect(needsRefresh(account(), now)).toBe(false)
  })

  it('refreshes Microsoft accounts that are expired, unpinned or close to expiry', () => {
    const ms = { kind: 'microsoft' as const }
    expect(needsRefresh(account({ ...ms }), now)).toBe(true)
    expect(needsRefresh(account({ ...ms, expiresAt: now - 1 }), now)).toBe(true)
    expect(needsRefresh(account({ ...ms, expiresAt: now + 30_000 }), now)).toBe(true)
    expect(needsRefresh(account({ ...ms, expiresAt: now + 3_600_000 }), now)).toBe(false)
  })
})

describe('device code timing', () => {
  it('computes the remaining time', () => {
    const now = 10_000
    expect(remainingMs(flow({ expiresAt: now + 5000 }), now)).toBe(5000)
    expect(remainingMs(flow({ expiresAt: now - 1 }), now)).toBe(0)
  })

  it('formats a mm:ss countdown', () => {
    expect(countdown(0)).toBe('00:00')
    expect(countdown(65_000)).toBe('01:05')
    expect(countdown(900_000)).toBe('15:00')
  })

  it('reports expiry once the flow is over', () => {
    const now = 10_000
    expect(decidePoll(flow({ expiresAt: now }), now)).toEqual({ action: 'expired' })
  })

  it('waits the full interval before the first poll', () => {
    const now = 10_000
    const decision = decidePoll(flow({ expiresAt: now + 900_000, intervalMs: 5000 }), now, 0)
    expect(decision).toEqual({ action: 'wait', delayMs: 5000 })
  })

  it('waits the remaining fraction of an interval mid-flight', () => {
    const now = 10_000
    const decision = decidePoll(flow({ expiresAt: now + 900_000, intervalMs: 5000 }), now, 2000)
    expect(decision).toEqual({ action: 'wait', delayMs: 3000 })
  })

  it('falls back to a sane interval when the provider omits one', () => {
    const now = 10_000
    const decision = decidePoll(flow({ expiresAt: now + 900_000, intervalMs: 0 }), now, 0)
    expect(decision).toEqual({ action: 'wait', delayMs: 5000 })
  })
})

describe('formatUserCode', () => {
  it('groups the code into two halves', () => {
    expect(formatUserCode('abcd1234')).toBe('ABCD-1234')
    expect(formatUserCode('AB-CD-12-34')).toBe('ABCD-1234')
    expect(formatUserCode('ABC')).toBe('ABC')
    expect(formatUserCode('')).toBe('')
  })
})

describe('shortUuid', () => {
  it('shortens a dashed uuid', () => {
    expect(shortUuid('12345678-1234-5678-1234-567812345678')).toBe('12345678…5678')
    expect(shortUuid('')).toBe('—')
  })
})

describe('sortAccounts', () => {
  it('puts the current account first, then Microsoft before offline, then by name', () => {
    const a = account({ id: 'a', name: 'Zed' })
    const b = account({ id: 'b', name: 'Amy', kind: 'microsoft' })
    const c = account({ id: 'c', name: 'Bob' })
    expect(sortAccounts([a, b, c], 'c').map((x) => x.id)).toEqual(['c', 'b', 'a'])
    expect(sortAccounts([a, b, c]).map((x) => x.id)).toEqual(['b', 'c', 'a'])
  })

  it('does not mutate the input', () => {
    const input = [account({ id: 'x', name: 'Z' }), account({ id: 'y', name: 'A' })]
    sortAccounts(input)
    expect(input.map((x) => x.id)).toEqual(['x', 'y'])
  })
})
