import { defineFeature } from '@rhine/plugin-api'
import { issueError, launcherState } from '../launcher-state'
import { request } from './internal/request'
import { bootstrap } from './internal/validation'

export default defineFeature<void, Promise<void>>({
  id: 'launcher.bootstrap', capability: 'launcher.bootstrap', title: '刷新启动器快照',
  execute(_input, env) {
    const state = launcherState(env)
    if (state.bootstrapFlight) return state.bootstrapFlight
    const revision = state.captureRevision()
    state.patch({ status: 'loading', error: null })
    let flight!: Promise<void>
    flight = (async () => {
      try {
        state.applyBootstrap(bootstrap(await request(env, '/api/bootstrap')), revision)
        if (state.snapshot.error) throw issueError(state.snapshot.error)
      } catch (error) { state.failBootstrap(error); throw error }
      finally { if (state.bootstrapFlight === flight) state.bootstrapFlight = undefined }
    })()
    state.bootstrapFlight = flight
    return flight
  },
})
