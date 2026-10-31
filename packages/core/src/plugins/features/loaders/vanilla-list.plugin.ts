import {defineFeature} from '@rhine/plugin-api'
export default defineFeature<void,unknown[]>({id:'loader.vanilla.list',capability:'loader.vanilla.list',title:'查询原版附加加载器',http:{method:'GET',path:'/api/loaders/vanilla',decode:()=>undefined},execute:()=>[]})
