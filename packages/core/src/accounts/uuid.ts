/**
 * UUID helpers shared by the account service.
 *
 * The offline UUID algorithm is the one the vanilla server uses: an MD5 hash of
 * 'OfflinePlayer:<name>' forced into RFC 4122 version 3 shape. Getting it wrong
 * makes the launcher and the server disagree about player data, so it gets its
 * own module and its own tests.
 */
import { createHash } from 'node:crypto'

/** Format 16 raw bytes as a canonical lowercase UUID. */
export function formatUuid(bytes: Uint8Array): string {
  if (bytes.length < 16) throw new Error('UUID 字节长度不足 16')
  const hex = Buffer.from(bytes.subarray(0, 16)).toString('hex')
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-')
}

/**
 * Offline-mode player UUID.
 *
 * Equivalent to the vanilla server's 'OfflinePlayer:<name>' MD5 identity:
 * version nibble 3, RFC 4122 variant.
 */
export function offlineUuid(name: string): string {
  const digest = createHash('md5').update('OfflinePlayer:' + name, 'utf8').digest()
  digest[6] = (digest[6] & 0x0f) | 0x30
  digest[8] = (digest[8] & 0x3f) | 0x80
  return formatUuid(digest)
}

/** Dashed UUID without hyphens, as used by Mojang auth payloads. */
export function compactUuid(uuid: string): string {
  return (uuid ?? '').replace(/-/g, '').toLowerCase()
}

/**
 * Expand a 32 character hex id into the canonical dashed form.
 *
 * @returns the dashed UUID, or undefined when the input is not a UUID body.
 */
export function expandUuid(value: string | undefined): string | undefined {
  const hex = compactUuid(value ?? '')
  if (!/^[0-9a-f]{32}$/.test(hex)) return undefined
  return formatUuid(Buffer.from(hex, 'hex'))
}

/** True when the value is a canonical dashed UUID. */
export function isUuid(value: string | undefined): boolean {
  return !!value && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
}
