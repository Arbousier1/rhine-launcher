/**
 * Pure helpers for the account page: name validation, device-code polling
 * arithmetic and avatar rendering.
 *
 * Validation mirrors the rules enforced by the backend AccountService so the
 * form can reject bad input before a round trip.
 */
import type { Account, DeviceCodeFlow } from '@rhine/core'

/** Minecraft user names are limited to 16 characters (offline mode included). */
export const NAME_MIN = 3
export const NAME_MAX = 16

/** Characters allowed by Minecraft's profile name rules. */
const NAME_PATTERN = /^[A-Za-z0-9_]+$/

/** Reserved names that the launcher refuses to create. */
const RESERVED = new Set([
  'steve', 'alex', 'player', 'null', 'undefined', 'admin', 'console', 'server',
])

/**
 * Validate an offline account name.
 *
 * @param name — raw form value (already trimmed by the caller or not).
 * @returns an error message in Chinese, or `undefined` when valid.
 */
export function validateOfflineName(name: string): string | undefined {
  const value = name.trim()
  if (!value) return '请输入用户名'
  if (value.length < NAME_MIN) return `用户名至少 ${NAME_MIN} 个字符`
  if (value.length > NAME_MAX) return `用户名最多 ${NAME_MAX} 个字符`
  if (!NAME_PATTERN.test(value)) return '用户名只能包含字母、数字和下划线'
  if (RESERVED.has(value.toLowerCase())) return '该用户名为保留名称，请换一个'
  return undefined
}

/** True when the name may be submitted. */
export function isValidOfflineName(name: string): boolean {
  return validateOfflineName(name) === undefined
}

/**
 * Derive the local avatar URL for an account.
 *
 * Microsoft accounts carry a remote skin URL; offline accounts use the first
 * letter on a deterministic accent background so the list stays recognisable.
 */
export function avatarUrl(account: Account): string | undefined {
  if (account.avatar) return account.avatar
  if (account.kind === 'microsoft' && account.uuid) {
    const compact = account.uuid.replace(/-/g, '')
    return 'https://crafatar.com/avatars/' + compact + '?size=64&overlay'
  }
  return undefined
}

/** Initial shown in the fallback avatar circle. */
export function avatarInitial(account: Account): string {
  return (account.name || '?').slice(0, 1).toUpperCase()
}

/** Kind label used in the account list. */
export function accountKindLabel(account: Account): string {
  if (account.kind === 'microsoft') return 'Microsoft'
  if (account.kind === 'authlib-injector') return '外置登录'
  return '离线'
}

/**
 * Whether a Microsoft account needs a refresh before launching.
 *
 * @param account — account record.
 * @param now — reference time, injectable for tests.
 * @param marginMs — refresh slightly before actual expiry.
 */
export function needsRefresh(account: Account, now = Date.now(), marginMs = 60_000): boolean {
  if (account.kind !== 'microsoft') return false
  if (!account.expiresAt) return true
  return account.expiresAt - marginMs <= now
}

/**
 * Remaining milliseconds of a device-code flow.
 *
 * @returns 0 when the flow already expired.
 */
export function remainingMs(flow: DeviceCodeFlow, now = Date.now()): number {
  return Math.max(0, flow.expiresAt - now)
}

/** `mm:ss` countdown for the device-code dialog. */
export function countdown(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return String(minutes).padStart(2, '0') + ':' + String(seconds).padStart(2, '0')
}

/**
 * Normalise the user-code for display: Microsoft returns `ABCD1234` style
 * codes that read better when the two halves are separated.
 */
export function formatUserCode(code: string): string {
  const value = code.replace(/[^A-Za-z0-9]/g, '').toUpperCase()
  if (value.length <= 4) return value
  return value.slice(0, 4) + '-' + value.slice(4)
}

/** State machine for the device-code dialog. */
export type DeviceFlowPhase = 'idle' | 'pending' | 'authorized' | 'expired' | 'error'

/**
 * Decide what the polling loop should do next.
 *
 * Split from the React effect so the timing logic is testable: the caller
 * simply follows the returned instruction.
 */
export type PollDecision =
  | { action: 'wait'; delayMs: number }
  | { action: 'expired' }

export function decidePoll(
  flow: DeviceCodeFlow,
  now = Date.now(),
  elapsedSinceStart = 0,
): PollDecision {
  if (remainingMs(flow, now) <= 0) return { action: 'expired' }
  const interval = Math.max(1000, flow.intervalMs || 5000)
  // Microsoft asks for `interval` between polls; skip the first one when the
  // flow was just created so the dialog does not hit the endpoint instantly.
  if (elapsedSinceStart < interval) {
    return { action: 'wait', delayMs: interval - elapsedSinceStart }
  }
  return { action: 'wait', delayMs: interval }
}

/** Copy a string to the clipboard, returning false when unsupported. */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {
    // Fall through to the legacy path.
  }
  try {
    const area = document.createElement('textarea')
    area.value = text
    area.style.position = 'fixed'
    area.style.opacity = '0'
    document.body.appendChild(area)
    area.select()
    const ok = document.execCommand('copy')
    document.body.removeChild(area)
    return ok
  } catch {
    return false
  }
}

/** Short uuid preview shown in the account detail column. */
export function shortUuid(uuid: string): string {
  if (!uuid) return '—'
  const compact = uuid.replace(/-/g, '')
  return compact.slice(0, 8) + '…' + compact.slice(-4)
}

/** Sort accounts so the currently selected one stays visible first. */
export function sortAccounts(accounts: Account[], currentId?: string): Account[] {
  const copy = [...accounts]
  copy.sort((a, b) => {
    if (a.id === currentId) return -1
    if (b.id === currentId) return 1
    if (a.kind !== b.kind) return a.kind === 'microsoft' ? -1 : 1
    return a.name.localeCompare(b.name, 'zh-CN')
  })
  return copy
}
