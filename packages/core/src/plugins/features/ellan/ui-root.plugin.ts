import { defineFeature } from '@rhine/plugin-api'
import { access } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
const root=fileURLToPath(new URL('../../../../../ellan-ui/dist/renderer/',import.meta.url))
export default defineFeature<void,Promise<{id:string;root:string;entry:string;ready:boolean}>>({
 id:'ui.ellan',capability:'ui.ellan',title:'原前端用户界面',
 http:{method:'GET',path:'/api/ui/ellan',decode:()=>undefined},
 async execute(){let ready=true;try{await access(root+'index.html')}catch{ready=false}return{id:'ui.ellan',root,entry:'index.html',ready}},
})
