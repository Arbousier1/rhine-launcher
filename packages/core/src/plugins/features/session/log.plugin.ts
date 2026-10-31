import { defineFeature,FeatureError } from '@rhine/plugin-api'
import { sessionState,sessionList,stopSession } from '../../../runtime/session-state.ts'
import {readId,query,integer} from '../../http-input.ts'
export default defineFeature<any,any>({id:'session.log',capability:'session.log',title:'session.log',depends:['paths.get','storage.read.sync'],http:{method:'GET',path:'/api/launch/sessions/:id/log',decode:(request,params)=>({id:params.id,tail:integer(query(request).tail,'tail',1,5000,400)})},execute(input,env){const id=readId(input),state=sessionState(env);if(!state.sessions.has(id))throw new FeatureError('NOT_FOUND','会话不存在',404);return {sessionId:id,lines:(state.logs.get(id)??[]).slice(-(input.tail??400))}}})
