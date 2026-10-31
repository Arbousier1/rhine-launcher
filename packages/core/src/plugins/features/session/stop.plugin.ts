import { defineFeature } from '@rhine/plugin-api'
import { sessionState,sessionList,stopSession } from '../../../runtime/session-state.ts'
import {readId,query,integer} from '../../http-input.ts'
export default defineFeature<any,any>({id:'session.stop',capability:'session.stop',title:'session.stop',depends:['paths.get','storage.read.sync'],http:{method:'POST',path:'/api/launch/sessions/:id/kill',decode:(_request,params)=>({id:params.id}),encode:()=>({ok:true})},execute(input,env){return stopSession(env,readId(input))}})
