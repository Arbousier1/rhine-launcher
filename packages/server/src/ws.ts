import type {Server,IncomingMessage} from 'node:http'
import { WebSocketServer,WebSocket } from 'ws'
import type {RhContext} from '@rhine/core'
import {requireLocalRequest} from './plugin-http.ts'

export const HEARTBEAT_INTERVAL_MS=30_000
export const MAX_WS_MESSAGE_BYTES=64*1024
export function isWsRequest(path:string|undefined):boolean{return (path??'').split('?')[0].replace(/\/$/,'')==='/ws'}
export interface WebSocketHandle { wss:WebSocketServer; dispose():Promise<void> }
/** Transport owns sockets; all application data comes from context-bound feature calls. */
export function attachWebSocket(server:Server,ctx:RhContext):WebSocketHandle {
 const wss=new WebSocketServer({noServer:true,maxPayload:MAX_WS_MESSAGE_BYTES})
 const alive=new WeakMap<WebSocket,boolean>()
 const send=(socket:WebSocket,data:unknown)=>{if(socket.readyState===WebSocket.OPEN)socket.send(JSON.stringify(data))}
 const snapshot=async(socket:WebSocket)=>{
  try{await ctx.features.settled();const bootstrap=await ctx.features.call('bootstrap');send(socket,{type:'bootstrap',bootstrap})}
  catch(error){send(socket,{type:'notice',level:'error',message:error instanceof Error?error.message:String(error)})}
 }
 const upgrade=(request:IncomingMessage,socket:any,head:Buffer)=>{
  const path=(request.url??'').split('?')[0]
  if(!isWsRequest(path)){socket.write('HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n');socket.destroy();return}
  try{
   requireLocalRequest(new Request('http://'+request.headers.host+request.url,{headers:request.headers as Record<string,string>}),['http://127.0.0.1:5183','http://localhost:5183'])
  }catch{socket.write('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n');socket.destroy();return}
  wss.handleUpgrade(request,socket,head,ws=>wss.emit('connection',ws,request))
 }
 server.on('upgrade',upgrade)
 wss.on('connection',socket=>{
  alive.set(socket,true)
  bindEvents()
  socket.on('close',()=>bindEvents())
  socket.on('pong',()=>alive.set(socket,true))
  socket.on('error',()=>socket.terminate())
  socket.on('message',bytes=>{
   try{
    const message=JSON.parse(bytes.toString())
    if(message.type==='ping')send(socket,{type:'pong',time:Date.now()})
    else if(message.type==='bootstrap')void snapshot(socket)
   }catch{send(socket,{type:'notice',level:'warn',message:'WebSocket 消息格式不正确'})}
  })
  void snapshot(socket)
 })
 let unsubscribeEvents:(()=>void)|undefined
 const bindEvents=()=>{
  unsubscribeEvents?.();unsubscribeEvents=undefined
  if(wss.clients.size>0&&ctx.features.has('events.subscribe.public'))unsubscribeEvents=ctx.features.call<()=>void>('events.subscribe.public',(event:unknown)=>{for(const socket of wss.clients)send(socket,event)})
 }
 bindEvents()
 const unsubscribeFeatures=ctx.features.subscribe(plugins=>{
  bindEvents()
  for(const socket of wss.clients)send(socket,{type:'plugins',plugins})
 })
 const heartbeat=setInterval(()=>{for(const socket of wss.clients){if(alive.get(socket)===false){socket.terminate();continue}alive.set(socket,false);socket.ping()}},HEARTBEAT_INTERVAL_MS)
 heartbeat.unref()
 let disposed=false
 return {wss,async dispose(){
  if(disposed)return;disposed=true
  clearInterval(heartbeat);unsubscribeEvents?.();unsubscribeFeatures();server.off('upgrade',upgrade)
  for(const socket of wss.clients)socket.terminate()
  await new Promise<void>(resolve=>wss.close(()=>resolve()))
 }}
}
