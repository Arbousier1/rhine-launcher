import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createHost } from '../src/index.ts'
import { createAccountsState, type AccountsState } from '../src/accounts/repository.ts'
import { storeMicrosoftFlow, pendingMicrosoftFlow, cancelMicrosoftFlows } from '../src/accounts/flows.ts'

const roots = new Set<string>()
afterEach(async () => {
  for (const root of roots) await rm(root, { recursive: true, force: true })
  roots.clear()
  vi.unstubAllEnvs()
})

const CONFIG = { clientId: '00000000-0000-0000-0000-0000000000aa', authority: 'https://login.microsoftonline.com/consumers/oauth2/v2.0' }
const DEVICE = {
  userCode: 'USER-CODE', verificationUri: 'https://www.microsoft.com/link',
  deviceCode: 'SECRET-DEVICE-CODE-NEVER-LEAVES', intervalMs: 5000, expiresAt: Date.now() + 60_000,
}

describe('device-code secrecy', () => {
  it('never returns the secret device code from the store, only from the retained flow', () => {
    const state: AccountsState = createAccountsState()
    try {
      const flow = storeMicrosoftFlow(state, DEVICE, CONFIG)
      // Callers get everything they need to poll, minus the secret.
      expect(flow).toMatchObject({ userCode: 'USER-CODE', verificationUri: 'https://www.microsoft.com/link' })
      expect(Object.keys(flow)).not.toContain('deviceCode')
      // The backend still holds it privately to complete the login.
      expect(pendingMicrosoftFlow(state, flow.flowId).flow.deviceCode).toBe('SECRET-DEVICE-CODE-NEVER-LEAVES')
    } finally { cancelMicrosoftFlows(state) }
  })

  it('keeps the secret off the public capability and HTTP response of begin', async () => {
    vi.stubEnv('RHINE_MICROSOFT_CLIENT_ID', '')
    const root = await mkdtemp(join(tmpdir(), 'rhine-device-secrecy-'))
    roots.add(root)
    const ctx = await createHost(new Context(), { root })
    try {
      await ctx.features.enable('auth.microsoft.begin')
      await ctx.features.enable('auth.microsoft.cancel')
      // Real Microsoft call with the shipped app identity.
      const flow = await ctx.features.call('auth.microsoft.begin', {})
      expect(flow.userCode).toMatch(/^[A-Z0-9]{6,12}$/)
      expect(Object.keys(flow)).not.toContain('deviceCode')
      expect(JSON.stringify(flow)).not.toMatch(/SECRET-DEVICE-CODE/)
      await ctx.features.call('auth.microsoft.cancel', { flowId: flow.flowId })
    } finally { await ctx.features.dispose() }
  }, 60_000)
})
