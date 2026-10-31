import {describe,it,expect} from 'vitest'
import {FeatureRuntime} from '@rhine/plugin-api'
import cancel from '../src/plugins/features/auth/microsoft-cancel.plugin'
import {createAccountsState} from '../src/accounts/repository'
import {storeMicrosoftFlow,pendingMicrosoftFlow,cancelMicrosoftFlows} from '../src/accounts/flows'
import {AccountError} from '../src/accounts/errors'
import {errorResponse} from '../../server/src/plugin-http'
describe('targeted native device-code cancellation',()=>{
 it('cancels only its chosen flow, clears credentials, and leaves another flow alive',async()=>{const state=createAccountsState(),runtime=new FeatureRuntime();runtime.state('engine.accounts',()=>state);runtime.register(cancel);await runtime.start();const config={clientId:'00000000-0000-0000-0000-000000000001',authority:'https://login.microsoftonline.com/consumers/oauth2/v2.0'},base={userCode:'USER-CODE',verificationUri:'https://microsoft.com/link',deviceCode:'SECRET',intervalMs:5000,expiresAt:Date.now()+60000};const one=storeMicrosoftFlow(state,base,config),two=storeMicrosoftFlow(state,{...base,userCode:'SECOND'},config),captured=state.flows.get(one.flowId)!;try{expect(runtime.call('auth.microsoft.cancel',{flowId:one.flowId})).toEqual({ok:true});expect(captured.controller.signal.aborted).toBe(true);expect(captured.flow.deviceCode).toBe('');expect(state.flows.has(one.flowId)).toBe(false);expect(()=>pendingMicrosoftFlow(state,one.flowId)).toThrow('取消');expect(pendingMicrosoftFlow(state,two.flowId).controller.signal.aborted).toBe(false);expect(runtime.call('auth.microsoft.cancel',{flowId:one.flowId})).toEqual({ok:true})}finally{cancelMicrosoftFlows(state);await runtime.dispose()}})
 it('returns only bounded retry metadata, never credentials in errors',async()=>{const error=Object.assign(new AccountError('等待授权','slow_down',{retryAfterMs:10000,intervalMs:10000}),{deviceCode:'SECRET',accessToken:'TOKEN'});expect(await errorResponse(error).json()).toEqual({code:'slow_down',message:'等待授权',retryAfterMs:10000,intervalMs:10000})})
})
