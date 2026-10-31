import {beforeEach,afterEach,describe,it,expect} from 'vitest'
import {createServer,type Server} from 'node:http'
import {mkdtemp,mkdir,writeFile,readFile,readdir,rm,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {createHash} from 'node:crypto'
import {defineFeature} from '@rhine/plugin-api'
import {createLauncherContext} from '../src/plugins/boot.ts'
import type {RhContext} from '../src/contracts.ts'
import type {Instance,ModUpdateInfo} from '../src/types.ts'
import {fixtureZip} from './support/zip-fixture.ts'
const jar=(version:string)=>fixtureZip({'fabric.mod.json':JSON.stringify({schemaVersion:1,id:'demo',version,name:'Demo'})})
const oldJar=jar('1.0.0'),newJar=jar('2.0.0')
const hash=(data:Buffer,algorithm='sha1')=>createHash(algorithm).update(data).digest('hex')
let ctx:RhContext,root:string,server:Server,base:string,calls:string[],installed:string[]
let mode:'normal'|'unknown'|'error'|'corrupt'|'manual'='normal'
const config={name:'Updates',gameVersion:'1.20.1',loaders:[{kind:'fabric' as const,version:'0.16.9'}],memory:{minMb:512,maxMb:2048},jvmArgs:[],gameArgs:[],window:{width:854,height:480,fullscreen:false}}

beforeEach(async()=>{
 root=await mkdtemp(join(tmpdir(),'rhine-content-'));ctx=await createLauncherContext({root});calls=[];installed=[];mode='normal'
 await ctx.features.replace('version.install',defineFeature({id:'version.install',capability:'version.install',title:'Vanilla fixture',execute:(input:any)=>{installed.push(input.gameVersion);return Promise.resolve()}}))
 server=createServer((req,res)=>{
  const url=new URL(req.url!,'http://127.0.0.1');url.pathname=url.pathname.replace(/^\/v[12](?:\/|$)/,'/');calls.push(req.method+' '+url.pathname)
  const json=(value:unknown,status=200)=>{res.writeHead(status,{'content-type':'application/json'});res.end(JSON.stringify(value))}
  if(mode==='error'&&url.pathname.includes('version_files'))return json({error:'temporary outage'},503)
  if(url.pathname==='/files/demo.jar'||url.pathname==='/files/demo-2.jar'){res.end(mode==='corrupt'?Buffer.from('tampered'):newJar);return}
  if(url.pathname==='/mods/123')return json({data:{id:123,gameId:432,classId:6,allowModDistribution:mode!=='manual'}})
  if(url.pathname==='/mods/123/files/456'){expect(req.headers['x-api-key']).toBe('test-key');return json({data:{id:456,modId:123,fileName:'demo.jar',fileLength:newJar.length,downloadUrl:mode==='manual'?null:base+'/files/demo.jar',hashes:[{algo:1,value:hash(newJar)}],gameVersions:['1.20.1','Fabric']}})}
  if(url.pathname==='/version_files')return json(mode==='unknown'?{}:{[hash(oldJar)]:{id:'old-version',project_id:'demo-project',version_number:'1.0.0',date_published:'2024-01-01T00:00:00Z'}})
  if(url.pathname==='/project/demo-project/version')return json([{id:'new-version',project_id:'demo-project',version_number:'2.0.0',date_published:'2025-01-01T00:00:00Z',game_versions:['1.20.1'],loaders:['fabric'],files:[{primary:true,filename:'demo-2.jar',url:base+'/files/demo-2.jar',hashes:{sha1:hash(newJar),sha512:hash(newJar,'sha512')},size:newJar.length}]}])
  json({error:'unexpected '+url.pathname},404)
 })
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));base='http://127.0.0.1:'+(server.address() as any).port
 await ctx.settings.update({curseforgeApiKey:'test-key',mirrors:{...ctx.settings.get().mirrors,modrinth:base,curseforge:base}})
})
afterEach(async()=>{await ctx?.features.dispose();if(server){server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()))}await rm(root,{recursive:true,force:true})})
async function mrpack(path='mods/demo.jar',extras:Record<string,string>={}){
 const index={formatVersion:1,game:'minecraft',versionId:'fixture-1',name:'Verified MR',dependencies:{minecraft:'1.20.1'},files:[{path,hashes:{sha1:hash(newJar),sha512:hash(newJar,'sha512')},fileSize:newJar.length,downloads:[base+'/files/demo.jar']}]}
 const file=join(root,'fixture.mrpack');await writeFile(file,fixtureZip({'modrinth.index.json':JSON.stringify(index),'overrides/config/value.txt':'base','client-overrides/config/value.txt':'client',...extras}));return file
}
async function cfpack(){const file=join(root,'fixture.zip');const manifest={manifestType:'minecraftModpack',manifestVersion:1,name:'Verified CF',version:'1',author:'fixture',minecraft:{version:'1.20.1',modLoaders:[]},files:[{projectID:123,fileID:456,required:true}],overrides:'overrides'};await writeFile(file,fixtureZip({'manifest.json':JSON.stringify(manifest),'overrides/options.txt':'fov:0.5'}));return file}
async function localMod(){const instance=await ctx.instances.create(config);await writeFile(join(instance.path,'mods','demo.jar.disabled'),oldJar);return instance}
async function check(instance:Instance){return ctx.features.call<Promise<ModUpdateInfo[]>>('mod.update.modrinth.check',{id:instance.id})}

describe('safe modpack imports through real feature composition',()=>{
 it('imports every required Modrinth file with hashes and client override precedence',async()=>{
  const instance=await ctx.features.call<Promise<Instance>>('modpack.import',{path:await mrpack()})
  expect(await readFile(join(instance.path,'mods','demo.jar'))).toEqual(newJar)
  expect(await readFile(join(instance.path,'config','value.txt'),'utf8')).toBe('client')
  expect(installed).toEqual(['1.20.1']);expect(ctx.instances.list()).toHaveLength(1)
  expect((await readdir(ctx.paths.get().temp)).filter(name=>name.startsWith('import-work-'))).toEqual([])
 })
 it('downloads CurseForge manifest.files instead of pretending overrides alone are success',async()=>{
  const instance=await ctx.features.call<Promise<Instance>>('modpack.import',{path:await cfpack()})
  expect(calls).toContain('GET /mods/123/files/456')
  expect(await readFile(join(instance.path,'mods','demo.jar'))).toEqual(newJar)
  expect(await readFile(join(instance.path,'options.txt'),'utf8')).toBe('fov:0.5')
 })
 it('rejects a required CF file whose author forbids third-party download',async()=>{
  mode='manual';await expect(ctx.features.call('modpack.import',{path:await cfpack()})).rejects.toThrow(/第三方|手动/)
  expect(ctx.instances.list()).toEqual([])
 })
 it('rejects manifest traversal without creating an instance or out-of-tree file',async()=>{
  await expect(ctx.features.call('modpack.import',{path:await mrpack('../escape.jar')})).rejects.toThrow()
  expect(ctx.instances.list()).toEqual([])
  await expect(stat(join(root,'escape.jar'))).rejects.toMatchObject({code:'ENOENT'})
 })
 it('rejects traversal in a ZIP override before extraction',async()=>{
  await expect(ctx.features.call('modpack.import',{path:await mrpack('mods/demo.jar',{'overrides/../../escape.txt':'bad'})})).rejects.toThrow()
  expect(ctx.instances.list()).toEqual([])
 })
 it('rolls back corrupt downloads rather than publishing a partial instance',async()=>{
  mode='corrupt';await expect(ctx.features.call('modpack.import',{path:await mrpack()})).rejects.toThrow()
  expect(ctx.instances.list()).toEqual([])
  expect((await readdir(ctx.paths.get().instances)).filter(name=>name.startsWith('.pending-'))).toEqual([])
 })
 it('keeps CurseForge import available when only Modrinth import is disabled',async()=>{
  await ctx.features.disable('modpack.modrinth.import')
  expect(ctx.features.has('modpack.curseforge.import')).toBe(true)
  await expect(ctx.features.call('modpack.import',{path:await mrpack()})).rejects.toThrow('未启用')
  expect(ctx.instances.list()).toEqual([])
 })
})

describe('truthful update checks and transactional apply',()=>{
 it('reports unknown hashes separately instead of saying all are current',async()=>{
  const instance=await localMod();mode='unknown';const results=await check(instance)
  expect(results).toHaveLength(1);expect(results[0].status).toBe('unknown');expect(results[0].updateId).toBeUndefined()
 })
 it('retains explicit network errors for each unchecked file',async()=>{
  const instance=await localMod();mode='error';const results=await check(instance)
  expect(results[0].status).toBe('error');expect(results[0].error?.message).toContain('503')
 })
 it('applies a checked update atomically and preserves .disabled',async()=>{
  const instance=await localMod();const [proposal]=await check(instance)
  expect(proposal.status).toBe('update')
  const result=await ctx.features.call<Promise<any>>('mod.update.apply',{id:instance.id,updateId:proposal.updateId})
  expect(result.diskName).toBe('demo-2.jar.disabled')
  expect(await readFile(join(instance.path,'mods','demo-2.jar.disabled'))).toEqual(newJar)
  await expect(stat(join(instance.path,'mods','demo.jar.disabled'))).rejects.toMatchObject({code:'ENOENT'})
  expect((await readdir(join(instance.path,'mods'))).filter(name=>name.startsWith('.update-'))).toEqual([])
 })
 it('preserves the old file when the update hash fails',async()=>{
  const instance=await localMod();const [proposal]=await check(instance);expect(proposal.status).toBe('update');mode='corrupt'
  await expect(ctx.features.call('mod.update.apply',{id:instance.id,updateId:proposal.updateId})).rejects.toThrow()
  expect(await readFile(join(instance.path,'mods','demo.jar.disabled'))).toEqual(oldJar)
 })
 it('rejects stale or forged proposals without modifying the user file',async()=>{
  const instance=await localMod();const [proposal]=await check(instance)
  const edited=jar('1.0.1');await writeFile(join(instance.path,'mods','demo.jar.disabled'),edited)
  await expect(ctx.features.call('mod.update.apply',{id:instance.id,updateId:proposal.updateId})).rejects.toThrow('改变')
  await expect(ctx.features.call('mod.update.apply',{id:instance.id,updateId:'forged'})).rejects.toThrow('过期')
  expect(await readFile(join(instance.path,'mods','demo.jar.disabled'))).toEqual(edited)
 })
})
