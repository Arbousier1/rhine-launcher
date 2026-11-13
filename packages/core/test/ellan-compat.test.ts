import { describe, it, expect } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLauncherContext } from '../src/index.ts'

describe('original Ellan UI compatibility capabilities', () => {
 it('returns real data with stable original shared-state identities', async () => {
  const root = await mkdtemp(join(tmpdir(), 'rhine-ellan-compat-'))
  const ctx = await createLauncherContext({root})
  const input = {rendererId:'test-renderer',args:[]}
  try {
   const settings = await ctx.features.call<{result:Record<string,unknown>}>('ellan.base.settings',input)
   const ui = await ctx.features.call<{id:string;ready:boolean}>('ui.ellan')
   expect(ui).toMatchObject({id:'ui.ellan',ready:true})
   await ctx.features.disable('ui.ellan')
   expect(ctx.features.has('instance.list')).toBe(true)
   await ctx.features.enable('ui.ellan')
   expect(settings.result.__state__).toBe('Settings')
   expect(settings.result.databaseReady).toBe(true)
   expect(settings.result.locale).toBe('zh-CN')
   expect(settings.result.disableTelemetry).toBe(true)
   const again = await ctx.features.call<{result:Record<string,unknown>}>('ellan.base.settings',input)
   expect(again.result.id).toBe(settings.result.id)
   await ctx.features.call('ellan.transport.commit',{rendererId:'test-renderer',args:[settings.result.id,'maxSocketsSet',3]})
   expect(ctx.features.call<import('../src/types.ts').Settings>('settings.get').concurrency).toBe(3)
   const instance = await ctx.features.call<{id:string,path:string}>('instance.create',{name:'原始界面测试',gameVersion:'1.20.1'})
   const instances = await ctx.features.call<{result:Record<string,unknown>}>('ellan.instance.state',input)
   expect(instances.result.__state__).toBe('InstanceState')
   expect((instances.result.instances as {path:string,name:string,version:string}[])[0]).toMatchObject({path:instance.path,name:'原始界面测试',version:''})
   const user = await ctx.features.call<{result:Record<string,unknown>}>('ellan.user.state',input)
   expect(user.result.users).toEqual({})
   const environment = await ctx.features.call<{result:Record<string,unknown>}>('ellan.base.environment',input)
   expect(environment.result.os).toBe(process.platform)
   expect(environment.result.env).toEqual({})
   const before:unknown[]=[]
   const off=ctx.features.call<()=>void>('events.subscribe',event=>before.push(event))
   await ctx.features.call('ellan.transport.revalidate',{rendererId:'test-renderer',args:[settings.result.id]})
   off()
   expect(before.some(e=>(e as {type:string,channel:string}).type==='ellan'&&(e as {channel:string}).channel==='commit')).toBe(true)
   await ctx.features.call('ellan.transport.unref',{rendererId:'test-renderer',args:[settings.result.id]})
   const third=await ctx.features.call<{result:Record<string,unknown>}>('ellan.base.settings',input)
   expect(third.result.id).not.toBe(settings.result.id)
  } finally {await ctx.features.dispose();await rm(root,{recursive:true,force:true})}
 },20000)
})
