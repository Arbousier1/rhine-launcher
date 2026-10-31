import {instancePatch,settingsPatch,launchRequest} from '../../validation.ts'
import { defineFeature } from '@rhine/plugin-api'
import { prepareFeatureLaunch,redactCommand } from '../../../runtime/feature-plan.ts'
import { json } from '../../http-input.ts'
export default defineFeature<any,any>({
 id:'launch.build',capability:'launch.build',title:'预览启动参数',
 depends:['instance.get','version.select','version.resolve','paths.get','account.get','java.pick'],
 http:{method:'POST',path:'/api/launch/build',decode:async request=>launchRequest(await json(request))},
 async execute(input,env){const plan=await prepareFeatureLaunch(input,env,true);return {command:redactCommand(plan.command,[plan.account.accessToken??'']),cwd:plan.cwd,mainClass:plan.mainClass}}
})
