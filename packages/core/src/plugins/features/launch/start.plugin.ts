import {instancePatch,settingsPatch,launchRequest} from '../../validation.ts'
import { defineFeature } from '@rhine/plugin-api'
import type { PreparedFeatureLaunch } from '../../../runtime/feature-plan.ts'
import type { LaunchSession } from '../../../types.ts'
import { json } from '../../http-input.ts'
/** The launch button performs one workflow: prepare then spawn, each independently owned. */
export default defineFeature<any,Promise<LaunchSession>>({
 id:'launch.start',capability:'launch.start',title:'启动游戏',depends:['launch.prepare','launch.spawn'],http:{method:'POST',path:'/api/launch',decode:async request=>launchRequest(await json(request)),status:202},
 async execute(input,env){const plan=await env.use<Promise<PreparedFeatureLaunch>>('launch.prepare',input);return env.use<Promise<LaunchSession>>('launch.spawn',plan)}
})
