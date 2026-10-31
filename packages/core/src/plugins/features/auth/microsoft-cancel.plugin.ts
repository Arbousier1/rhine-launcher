import {defineFeature} from '@rhine/plugin-api'
import {accountsState} from '../../../accounts/environment.ts'
import {finishMicrosoftFlow} from '../../../accounts/flows.ts'
import {readAccountRequest,requestString} from '../../../accounts/http.ts'
/** Cancel one device flow without affecting another player's login. */
export default defineFeature<{flowId:string},{ok:true}>({id:'auth.microsoft.cancel',capability:'auth.microsoft.cancel',title:'取消微软设备码登录',http:{method:'POST',path:'/api/accounts/microsoft/cancel',decode:async request=>({flowId:requestString(await readAccountRequest(request),'flowId')!})},execute(input,env){const flowId=requestString(input,'flowId')!;finishMicrosoftFlow(accountsState(env),flowId,'FLOW_CANCELLED');return {ok:true}}})
