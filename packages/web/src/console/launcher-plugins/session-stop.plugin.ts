import { defineFeature } from '@rhine/plugin-api'
import { activeSession, launcherState } from '../launcher-state'
import { action, request } from './internal/request'
import { success, text } from './internal/validation'

export default defineFeature<{ sessionId: string }, Promise<void>>({
  id: 'launcher.session.stop', capability: 'launcher.session.stop', title: '停止启动会话',
  execute(input, env) {
    const id = text(input?.sessionId, '会话 id')
    const instanceId = launcherState(env).snapshot.sessions.find(item => item.id === id)?.instanceId
    return action(env, 'stop', instanceId, async state => {
      success(await request(env, '/api/launch/sessions/' + encodeURIComponent(id) + '/kill', { method: 'POST' }))
      const current = state.snapshot.sessions.find(item => item.id === id)
      // Native kill awaits process.stop(). Keep any more specific exit event, and invent no timestamp/code.
      if (current && activeSession(current)) state.upsertSession({ ...current, status: 'stopped' })
    })
  },
})
