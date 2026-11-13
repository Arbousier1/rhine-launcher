import {defineFeature} from '@rhine/plugin-api'
import {arch,cpus,platform,release,totalmem} from 'node:os'
/** Read-only host facts the launcher UI can display; it changes no game state. */
export default defineFeature<void,Promise<{platform:string;arch:string;release:string;cpuModel:string;cpuCount:number;totalMemoryMb:number}>>({
 id:'system.info',capability:'system.info',title:'查询系统内存与平台信息',
 http:{method:'GET',path:'/api/system/info',decode:()=>undefined,status:200},
 async execute(){const list=cpus();return {platform:platform(),arch:arch(),release:release(),cpuModel:list[0]?.model?.trim()??'未知处理器',cpuCount:list.length,totalMemoryMb:Math.floor(totalmem()/1024/1024)}},
})
