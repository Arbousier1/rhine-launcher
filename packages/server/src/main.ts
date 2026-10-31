import { serve } from '@hono/node-server'
import type { Server } from 'node:http'
import { createLauncherContext } from '@rhine/core'
import { createServerApp } from './app.ts'
import { attachWebSocket } from './ws.ts'
import { pathToFileURL } from 'node:url'

export async function main(argv=process.argv.slice(2)):Promise<void>{
 let port=6550,root:string|undefined
 for(let i=0;i<argv.length;i++){
  if(argv[i]==='--port')port=Number(argv[++i])
  else if(argv[i]==='--data-dir')root=argv[++i]
  else if(argv[i]==='--help'){console.log('Rhine Launcher --port 6550 --data-dir <目录>');return}
  else throw new Error('未知选项：'+argv[i])
 }
 if(!Number.isInteger(port)||port<0||port>65535)throw new Error('端口必须为 0–65535')
 const ctx=await createLauncherContext({root})
 const app=createServerApp(ctx)
 const server=serve({fetch:app.fetch,hostname:'127.0.0.1',port},info=>{
  console.log('Rhine Launcher: http://127.0.0.1:'+info.port)
  console.log('数据目录: '+ctx.paths.get().root)
  const unavailable=ctx.features.list().filter(item=>item.status!=='enabled')
  if(unavailable.length)console.warn('未就绪的独立功能:',unavailable.map(item=>item.id+': '+item.status).join(', '))
 }) as Server
 const ws=attachWebSocket(server,ctx)
 let shutting=false
 const shutdown=async()=>{
  if(shutting)return;shutting=true
  await ws.dispose()
  await ctx.features.dispose()
  await new Promise<void>(resolve=>server.close(()=>resolve()))
 }
 process.once('SIGINT',()=>{void shutdown().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)})})
 process.once('SIGTERM',()=>{void shutdown().then(()=>process.exit(0),error=>{console.error(error);process.exit(1)})})
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){void main().catch(error=>{console.error('启动失败:',error);process.exitCode=1})}
