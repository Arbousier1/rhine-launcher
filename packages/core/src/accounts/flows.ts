import { randomUUID } from 'node:crypto'
import type { DeviceCodeFlow } from '../types.ts'
import type { AccountsState } from './repository.ts'
import type { MicrosoftConfiguration } from './config.ts'
import type { MicrosoftTokens } from './microsoft.ts'
import { AccountError } from './errors.ts'

export interface BoundDeviceCodeFlow extends DeviceCodeFlow {
  flowId: string
  clientId: string
  authority: string
}
export interface PendingMicrosoftFlow {
  flow: BoundDeviceCodeFlow
  controller: AbortController
  timer?: ReturnType<typeof setTimeout>
  nextPollAt: number
  lastPollCode: 'authorization_pending' | 'slow_down'
  busy: boolean
  tokens?: MicrosoftTokens
}

/** Bind immutable app identity to this flow instead of consulting mutable settings at poll time. */
export function storeMicrosoftFlow(state: AccountsState, flow: DeviceCodeFlow, config: MicrosoftConfiguration): BoundDeviceCodeFlow {
  // Bound concurrent flows to avoid retaining abandoned device-code secrets indefinitely.
  if (state.flows.size >= 4) finishMicrosoftFlow(state, state.flows.keys().next().value!, 'FLOW_CANCELLED')
  const bound: BoundDeviceCodeFlow = { ...flow, ...config, flowId: randomUUID() }
  const pending: PendingMicrosoftFlow = { flow: bound, controller: new AbortController(), nextPollAt: 0, lastPollCode: 'authorization_pending', busy: false }
  pending.timer = setTimeout(() => finishMicrosoftFlow(state, bound.flowId, 'EXPIRED_TOKEN'), Math.max(1, bound.expiresAt - Date.now()))
  pending.timer.unref?.()
  state.flows.set(bound.flowId, pending)
  state.latestFlowId = bound.flowId
  return { ...bound }
}
export function pendingMicrosoftFlow(state: AccountsState, id = state.latestFlowId): PendingMicrosoftFlow {
  const pending = id && state.flows.get(id)
  if (!pending) {
    const terminal = id && state.terminalFlows.get(id)
    if (terminal === 'EXPIRED_TOKEN') throw new AccountError('设备码已过期，请重新开始微软登录（expired_token）', 'EXPIRED_TOKEN', { flowId: id })
    if (terminal === 'FLOW_CANCELLED') throw new AccountError('微软登录已取消，请重新开始', 'FLOW_CANCELLED', { flowId: id })
    throw new AccountError('没有正在进行的微软登录，请先点击「微软账号登录」', 'NO_PENDING_FLOW')
  }
  if (Date.now() >= pending.flow.expiresAt) {
    finishMicrosoftFlow(state, pending.flow.flowId, 'EXPIRED_TOKEN')
    throw new AccountError('设备码已过期，请重新开始微软登录（expired_token）', 'EXPIRED_TOKEN', { flowId: pending.flow.flowId })
  }
  return pending
}
export function finishMicrosoftFlow(state: AccountsState, id: string, reason?: 'EXPIRED_TOKEN' | 'FLOW_CANCELLED'): void {
  const pending = state.flows.get(id)
  if (!pending) return
  clearTimeout(pending.timer)
  pending.controller.abort()
  // Drop secrets even if a caller still holds the pending object.
  pending.flow.deviceCode = ''
  pending.tokens = undefined
  state.flows.delete(id)
  if (reason) {
    state.terminalFlows.set(id, reason)
    while (state.terminalFlows.size > 16) state.terminalFlows.delete(state.terminalFlows.keys().next().value!)
  } else {
    state.terminalFlows.delete(id)
    if (state.latestFlowId === id) state.latestFlowId = undefined
  }
}
export function cancelMicrosoftFlows(state: AccountsState): void {
  for (const id of [...state.flows.keys()]) finishMicrosoftFlow(state, id, 'FLOW_CANCELLED')
}
