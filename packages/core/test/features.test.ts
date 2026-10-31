import {afterEach,describe,it,expect} from 'vitest'
import {mkdtemp,readFile,readdir,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createLauncherContext} from '../src/plugins/boot.ts'
import type {RhContext} from '../src/contracts.ts'
const contexts:{root:string;ctx:RhContext}[]=[]
async function host(){const root=await mkdtemp(join(tmpdir(),'rhine-native-feature-'));const ctx=await createLauncherContext({root});contexts.push({root,ctx});return {root,ctx}}
afterEach(async()=>{for(const {root,ctx}of contexts.splice(0)){await ctx.features.dispose();await rm(root,{recursive:true,force:true})}})
const config={name:'Native archive',gameVersion:'1.20.1',loaders:[],memory:{minMb:512,maxMb:2048},jvmArgs:[],gameArgs:[],window:{width:854,height:480,fullscreen:false}}

describe('production capability composition, not aggregate Service fixtures',()=>{
 it('loads a real independent Cordis fiber for every feature',async()=>{
  const {ctx}=await host();const list=ctx.features.list()
  expect(list.length).toBeGreaterThan(90)
  expect(list.every(item=>item.id===item.capability&&item.status==='enabled')).toBe(true)
  expect(ctx.registry.size).toBe(list.length)
 })
 it('disabling a loader install leaves its list and other loaders available',async()=>{
  const {ctx}=await host();await ctx.features.disable('loader.fabric.install')
  expect(ctx.features.has('loader.fabric.list')).toBe(true)
  expect(ctx.features.has('loader.quilt.install')).toBe(true)
  expect(()=>ctx.loader.install('fabric','1.20.1','0.16.9')).toThrow('未启用')
  expect(ctx.features.has('instance.list')).toBe(true)
 })
 it('offline login keeps working after Microsoft login is removed',async()=>{
  const {ctx}=await host();await ctx.features.disable('auth.microsoft.begin')
  const account=await ctx.accounts.addOffline('Independent')
  expect(account.name).toBe('Independent')
  expect(account.kind).toBe('offline')
  await expect(ctx.accounts.authorize(account.id)).resolves.toMatchObject({id:account.id})
 })
 it('read and write are separate and committed files survive feature teardown',async()=>{
  const {ctx}=await host();const instance=await ctx.instances.create(config)
  await ctx.instances.writeFile(instance.id,'config/feature.txt','saved data')
  await ctx.features.disable('file.write')
  expect(await ctx.instances.readFile(instance.id,'config/feature.txt')).toBe('saved data')
  expect(()=>ctx.instances.writeFile(instance.id,'config/feature.txt','bad')).toThrow()
  await ctx.features.enable('file.write')
  await ctx.instances.writeFile(instance.id,'config/feature.txt','new data')
  expect(await readFile(join(instance.path,'config/feature.txt'),'utf8')).toBe('new data')
 })
 it('cancelled creation rolls back its own reserved directories',async()=>{
  const {ctx}=await host();const controller=new AbortController();controller.abort()
  expect(()=>ctx.features.call('instance.create',config,{signal:controller.signal})).toThrow()
  expect(ctx.instances.list()).toEqual([])
  expect(await readdir(ctx.paths.get().instances)).toEqual([])
 })
 it('bootstrap represents unavailable actions explicitly',async()=>{
  const {ctx}=await host();await ctx.features.disable('instance.list')
  const snapshot=await ctx.features.call<Promise<any>>('bootstrap')
  expect(snapshot.unavailable.instances.feature).toBe('instance.list')
  expect(snapshot.plugins.find((item:any)=>item.id==='instance.list').status).toBe('disabled')
 })
 it('saves and restores disabled plugin configuration without changing installed data',async()=>{
  const {ctx,root}=await host();const account=await ctx.accounts.addOffline('Persisted')
  await ctx.features.call<Promise<any>>('plugins.disable',{id:'file.write'})
  expect(JSON.parse(await readFile(join(root,'plugins.json'),'utf8')).disabled).toContain('file.write')
  await ctx.features.dispose()
  const next=await createLauncherContext({root});contexts.push({ctx:next,root})
  expect(next.features.has('file.write')).toBe(false)
  expect(next.accounts.get(account.id)?.name).toBe('Persisted')
 })
})
