import { defineFeature } from '@rhine/plugin-api'
import { sessionState,sessionList,stopSession } from '../../../runtime/session-state.ts'
import {readId,query,integer} from '../../http-input.ts'
export default defineFeature<any,any>({id:'session.list',capability:'session.list',title:'session.list',depends:['paths.get','storage.read.sync'],http:{method:'GET',path:'/api/launch/sessions',decode:()=>undefined},execute(input,env){return sessionList(env)}})
