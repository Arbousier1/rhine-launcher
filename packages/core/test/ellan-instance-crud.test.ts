import {describe,it,expect} from 'vitest'
import {mkdtemp,rm,stat} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join,isAbsolute} from 'node:path'
import {createLauncherContext} from '../src/index.ts'
import type {Instance} from '../src/types.ts'
describe('original InstanceService CRUD',()=>{
 it('returns canonical paths, preserves actual core fields and original metadata, and rolls back invalid creates',async()=>{
  const root=await mkdtemp(join(tmpdir(),'rhine-original-crud-')),ctx=await createLauncherContext({root}),owner='original-crud'
  const call=async<T>(id:string,args:unknown[])=>{const value=await ctx.features.call<{result:T}>(id,{rendererId:owner,args});return value.result}
  try{
   const path=await call<string>('ellan.instance.create',[{name:'Original',runtime:{minecraft:'1.20.1',fabricLoader:'0.20.1'},minMemory:512,maxMemory:2048,description:'Original-only description',vmOptions:['-Dfixture=true']}])
   expect(isAbsolute(path)).toBe(true)
   await call('ellan.instance.edit',[{instancePath:path,name:'Edited',maxMemory:3072,runtime:{minecraft:'1.20.2'}}])
   let instances=await ctx.features.call<Promise<Instance[]>>('instance.list'),original=instances.find(i=>i.path===path)!
   expect(original).toMatchObject({name:'Edited',gameVersion:'1.20.2',memory:{minMb:512,maxMb:3072},loaders:[{kind:'fabric',version:'0.20.1'}]})
   await ctx.features.call('instance.update',{id:original.id,patch:{name:'Changed outside original UI',memory:{minMb:768,maxMb:4096}}})
   const state=await call<{instances:{path:string;name:string;minMemory:number;maxMemory:number;description:string}[]}>('ellan.instance.state',[])
   expect(state.instances.find(i=>i.path===path)).toMatchObject({name:'Changed outside original UI',minMemory:768,maxMemory:4096,description:'Original-only description'})
   const copy=await call<string>('ellan.instance.duplicate',[path]);expect(copy).not.toBe(path);expect(isAbsolute(copy)).toBe(true)
   const cloned=await call<{instances:{path:string;description:string}[]}>('ellan.instance.state',[])
   expect(cloned.instances.find(i=>i.path===copy)?.description).toBe('Original-only description')
   const count=(await ctx.features.call<Promise<Instance[]>>('instance.list')).length
   await expect(call('ellan.instance.create',[{name:'Invalid',runtime:{minecraft:'1.20.1'},maxMemory:-1}])).rejects.toBeDefined()
   expect((await ctx.features.call<Promise<Instance[]>>('instance.list')).length).toBe(count)
   await expect(call('ellan.instance.create',[{name:'No fabricated game version'}])).rejects.toMatchObject({code:'EMPTY_RUNTIME_UNSUPPORTED'})
   await expect(call('ellan.instance.remove',[path,'false'])).rejects.toMatchObject({code:'INVALID_ORIGINAL_CALL'})
   await call('ellan.instance.remove',[copy,true]);expect(await stat(copy).catch(()=>undefined)).toBeUndefined()
   await call('ellan.instance.remove',[path,true]);expect((await ctx.features.call<Promise<Instance[]>>('instance.list')).length).toBe(0)
  }finally{await ctx.features.dispose();await rm(root,{recursive:true,force:true})}
 },20000)
})
