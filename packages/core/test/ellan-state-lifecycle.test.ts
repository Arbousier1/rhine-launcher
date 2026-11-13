import {describe,it,expect} from 'vitest'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLauncherContext} from '../src/index.ts'
import {writeOriginalServers} from '@rhine/ellan-ui/game-data'
describe('original shared-state ownership and actual game files',()=>{
 it('does not release another renderer reference, and restores real server/options data',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rhine-original-state-'))
  const ctx=await createLauncherContext({root})
  try{
   const input={rendererId:'one',args:[]}
   const first=await ctx.features.call<{result:{id:string}}>('ellan.base.settings',input)
   const second=await ctx.features.call<{result:{id:string}}>('ellan.base.settings',{rendererId:'two',args:[]})
   expect(second.result.id).toBe(first.result.id)
   await ctx.features.call('ellan.transport.unref',{rendererId:'one',args:[first.result.id]})
   const retained=await ctx.features.call<{result:{id:string}}>('ellan.base.settings',{rendererId:'two',args:[]})
   expect(retained.result.id).toBe(first.result.id)
   await ctx.features.call('ellan.transport.release-renderer',{rendererId:'two',args:[]})
   const fresh=await ctx.features.call<{result:{id:string}}>('ellan.base.settings',input)
   expect(fresh.result.id).not.toBe(first.result.id)
   const instance=await ctx.features.call<{path:string}>('instance.create',{name:'State files',gameVersion:'1.20.1'})
   await writeFile(join(instance.path,'options.txt'),'lang:fr_fr\nfullscreen:false\nresourcePacks:["vanilla","file/custom.zip"]\n')
   await writeFile(join(instance.path,'eula.txt'),'eula=true\n')
   await writeFile(join(instance.path,'servers.dat'),await writeOriginalServers([{name:'Actual server',ip:'example.invalid:25565',icon:'',acceptTextures:1}]))
   const options=await ctx.features.call<{result:{lang:string;eula:boolean;fullscreen:boolean;resourcePacks:string[]}}>('ellan.options.watch',{rendererId:'one',args:[instance.path]})
   expect(options.result).toMatchObject({lang:'fr_fr',eula:true,fullscreen:false,resourcePacks:['vanilla','file/custom.zip']})
   const change=new Promise<void>((resolve,reject)=>{
    const timeout=setTimeout(()=>{off();reject(new Error('Original file watcher did not publish a real option change'))},3000)
    const off=ctx.features.call<()=>void>('events.subscribe',(event:unknown)=>{
     if(!event||typeof event!=='object'||Reflect.get(event,'type')!=='ellan'||Reflect.get(event,'channel')!=='commit')return
     const args=Reflect.get(event,'args')
     if(Array.isArray(args)&&args[1]==='gameOptionsSet'&&args[2]?.lang==='de_de'){clearTimeout(timeout);off();resolve()}
    })
   })
   await writeFile(join(instance.path,'options.txt'),['lang:de_de','fullscreen:false',''].join(String.fromCharCode(10)))
   await change
   const servers=await ctx.features.call<{result:{serverInfos:{name:string;ip:string}[]}}>('ellan.servers.watch',{rendererId:'one',args:[instance.path]})
   expect(servers.result.serverInfos).toMatchObject([{name:'Actual server',ip:'example.invalid:25565'}])
   const saves=await ctx.features.call<{result:{__state__:string;saves:unknown[]}}>('ellan.saves.watch',{rendererId:'one',args:[instance.path]})
   expect(saves.result).toMatchObject({__state__:'Saves',saves:[]})
   await ctx.features.call('ellan.transport.revalidate',{rendererId:'one',args:[(servers.result as unknown as {id:string}).id]})
   await ctx.features.call('ellan.transport.revalidate',{rendererId:'one',args:[(options.result as unknown as {id:string}).id]})
  }finally{await ctx.features.dispose();await rm(root,{recursive:true,force:true})}
 },20000)
})
