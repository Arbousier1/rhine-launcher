import { defineFeature } from '@rhine/plugin-api'
export default defineFeature<void,any>({id:'plugins.list',capability:'plugins.list',title:'列出独立功能插件',http:{method:'GET',path:'/api/plugins',decode:()=>undefined},execute:(_input,env)=>env.context.features.list()})
