import { defineFeature } from '@rhine/plugin-api'
import type { Account } from '../../../types.ts'
import { ACCOUNT_WRITE_DEPENDS, accountsState, accountRepository } from '../../../accounts/environment.ts'
import { cancelMicrosoftFlows, finishMicrosoftFlow, pendingMicrosoftFlow } from '../../../accounts/flows.ts'
import { microsoftEndpoints } from '../../../accounts/config.ts'
import { exchangeMicrosoftForMinecraft } from '../../../accounts/microsoft-chain.ts'
import { AUTHORIZATION_PENDING, parseTokenBody, tokenErrorCode, oauthErrorHint, type TokenBody } from '../../../accounts/microsoft.ts'
import { AccountError, throwIfAborted } from '../../../accounts/errors.ts'
import { FORM_HEADERS, formEncode, requestJson, readAccountRequest, requestString } from '../../../accounts/http.ts'
import { redactAccount } from '../../../accounts/repository.ts'

export default defineFeature<{ flowId?: string } | undefined, Promise<Account>>({
  id: 'auth.microsoft.complete', capability: 'auth.microsoft.complete', title: '完成微软设备码登录', depends: ACCOUNT_WRITE_DEPENDS,
  http: { method: 'POST', path: '/api/accounts/microsoft/complete', encode: redactAccount,
    decode: async request => ({ flowId: requestString(await readAccountRequest(request), 'flowId', true) }) },
  setup(env) { const state = accountsState(env); env.onDispose(() => cancelMicrosoftFlows(state)) },
  async execute(input, env) {
    const state = accountsState(env)
    const pending = pendingMicrosoftFlow(state, input?.flowId)
    const flow = pending.flow
    const retryAfterMs = Math.max(0, pending.nextPollAt - Date.now())
    if (pending.busy || (!pending.tokens && retryAfterMs > 0)) {
      throw new AccountError(oauthErrorHint(pending.lastPollCode) + '（' + pending.lastPollCode + '）', pending.lastPollCode,
        { flowId: flow.flowId, intervalMs: flow.intervalMs, retryAfterMs: retryAfterMs || flow.intervalMs })
    }
    pending.busy = true
    const signal = AbortSignal.any([env.signal, pending.controller.signal])
    try {
      env.task?.throwIfCancelled()
      if (!pending.tokens) {
        pending.nextPollAt = Date.now() + flow.intervalMs
        const response = await requestJson<TokenBody>(microsoftEndpoints(flow).token, {
          method: 'POST', headers: FORM_HEADERS,
          body: formEncode({ grant_type: 'urn:ietf:params:oauth:grant-type:device_code', client_id: flow.clientId, device_code: flow.deviceCode }),
        }, '轮询微软授权结果', signal)
        const code = tokenErrorCode(response.body)
        if (response.status < 200 || response.status >= 300 || code) {
          const failure = code ?? 'MICROSOFT_AUTH_FAILED'
          if (failure === AUTHORIZATION_PENDING || failure === 'slow_down') {
            pending.lastPollCode = failure
            if (failure === 'slow_down') flow.intervalMs += 5000
            pending.nextPollAt = Date.now() + flow.intervalMs
            throw new AccountError(oauthErrorHint(failure) + '（' + failure + '）', failure,
              { flowId: flow.flowId, intervalMs: flow.intervalMs, retryAfterMs: flow.intervalMs })
          }
          finishMicrosoftFlow(state, flow.flowId)
          throw new AccountError(oauthErrorHint(failure) + '（' + failure + '）', failure)
        }
        pending.tokens = parseTokenBody(response.body)
        if (!pending.tokens) {
          finishMicrosoftFlow(state, flow.flowId)
          throw new AccountError('微软没有返回有效访问令牌，请重新开始登录', 'INVALID_TOKEN_RESPONSE')
        }
      }
      // If a downstream transport/disk error occurs, retain the already-issued Microsoft token for a retry;
      // do not exchange the consumed device code a second time or pretend the user is logged in.
      const account = await exchangeMicrosoftForMinecraft(pending.tokens, flow, signal)
      throwIfAborted(signal)
      env.task?.throwIfCancelled()
      const stored = await accountRepository(env).upsert(account)
      finishMicrosoftFlow(state, flow.flowId)
      return stored
    } catch (error) {
      if (signal.aborted) {
        const reason = state.terminalFlows.get(flow.flowId)
        if (reason === 'EXPIRED_TOKEN') throw new AccountError('设备码已过期（expired_token），请重新登录', 'EXPIRED_TOKEN', { flowId: flow.flowId })
        finishMicrosoftFlow(state, flow.flowId, 'FLOW_CANCELLED')
        throw new AccountError('微软登录操作已取消', 'FLOW_CANCELLED', { flowId: flow.flowId })
      }
      throw error
    } finally { pending.busy = false }
  },
})
