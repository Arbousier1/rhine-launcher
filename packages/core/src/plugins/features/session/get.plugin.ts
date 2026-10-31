import { defineFeature } from '@rhine/plugin-api'
import { sessionState,sessionList,stopSession } from '../../../runtime/session-state.ts'
import {readId,query,integer} from '../../http-input.ts'
export default defineFeature<any,any>({id:'session.get',capability:'session.get',title:'session.get',depends:['paths.get','storage.read.sync'],http:{method:'GET',path:'/api/launch/sessions/:id',decode:(_request,params)=>({id:params.id})},execute(input,env){return sessionState(env).sessions.get(readId(input))}})
