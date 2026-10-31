import { Hono } from 'hono'
import type { RhContext } from '@rhine/core'
import { dispatchFeature,errorResponse,requireLocalRequest } from './plugin-http.ts'
import { hasWebDist,lookupStatic,readStaticFile,readPlaceholder,resolveWebDist } from './static.ts'

export interface ServerAppOptions { webDist?:string; allowedOrigins?:string[]; ready?:Promise<unknown> }
/** Host shell: context-bound feature dispatch and static transport only. */
export function createServerApp(ctx:RhContext,options:ServerAppOptions={}):Hono {
  if(!ctx.features)throw new Error('HTTP 宿主需要已配置的单功能插件运行时')
  const app=new Hono(),dist=resolveWebDist(options.webDist)
  app.use('*',async(c,next)=>{
    try{
      requireLocalRequest(c.req.raw,options.allowedOrigins??['http://127.0.0.1:5183','http://localhost:5183'])
      await options.ready
      c.header('X-Content-Type-Options','nosniff')
      c.header('Referrer-Policy','no-referrer')
      if(c.req.path.startsWith('/api/')){c.header('Cache-Control','no-store');return await dispatchFeature(ctx.features,c.req.raw)}
      await next()
    }catch(error){return errorResponse(error)}
  })
  app.get('*',async c=>{
    if(!hasWebDist(dist))return c.html(await readPlaceholder())
    const file=lookupStatic(dist,c.req.path)
    if(!file)return c.text('前端资源未找到',404)
    return readStaticFile(file)
  })
  app.notFound(c=>c.json({code:'NOT_FOUND',message:'接口不存在'},404))
  app.onError(error=>errorResponse(error))
  return app
}
