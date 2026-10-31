import {describe,it,expect} from 'vitest'
import {buildCatalog,emptyRecord,versionFamily,instanceRecord,tickWindow,type CatalogSelection} from '../src/console/catalog-model'
import {launcherDetailMarkup} from '../src/console/launcher-detail'
const selection:CatalogSelection={mode:'instances',channel:'release',family:'',query:''}
const ids=new Map<string,string>();const id=(key:string)=>{if(!ids.has(key))ids.set(key,'X-'+String(ids.size+1).padStart(3,'0'));return ids.get(key)!}
const instances=[{id:'survival',name:'和朋友的生存服',gameVersion:'1.20.1',loaders:[{kind:'fabric',version:'0.16.9'}]},{id:'technical',name:'红石试验场',gameVersion:'1.20.1',loaders:[]},{id:'modpack',name:'机械动力整合包',gameVersion:'1.19.2',loaders:[{kind:'forge',version:'43.4.0'}]}]
const versions=[{id:'26.1.2',type:'release',releaseTime:'2026-09-30T00:00:00Z'},{id:'26w40a',type:'snapshot',releaseTime:'2026-10-01T00:00:00Z'},{id:'1.21.4',type:'release'},{id:'1.20.6',type:'release'},{id:'1.20.1',type:'release'},{id:'b1.7.3',type:'old_beta'}]
describe('understandable Minecraft catalog, not a wall of bare version numbers',()=>{
 it('identifies installed instances by player-assigned purpose, not by version alone',()=>{
  const result=buildCatalog(instances,versions,selection,id)
  expect(result.records.map(record=>record.title)).toEqual(instances.map(instance=>instance.name))
  expect(result.records[0]).toMatchObject({kind:'instance',gameVersion:'1.20.1',loaderLabel:'Fabric 0.16.9',instanceId:'survival'})
  expect(result.records[1].id).not.toBe(result.records[0].id)
 })
 it('uses actual loader groups and does not duplicate every instance into five fictional departments',()=>{
  const result=buildCatalog(instances,versions,selection,id)
  expect(result.columns).toEqual(['Fabric','原版实例','Forge'])
  expect(new Set(result.records.map(record=>record.key)).size).toBe(3)
 })
 it('defaults version browsing to releases only',()=>{
  const result=buildCatalog(instances,versions,{...selection,mode:'versions'},id)
  expect(result.records.every(record=>record.version?.type==='release')).toBe(true)
  expect(result.records.find(record=>record.recommended)?.gameVersion).toBe('26.1.2')
  expect(result.records.map(record=>record.gameVersion)).not.toContain('26w40a')
 })
 it('groups both old numbering and new numbering by a meaningful series',()=>{
  expect(versionFamily(versions[0])).toBe('26.1.x')
  expect(versionFamily(versions[4])).toBe('1.20.x')
  expect(versionFamily(versions[1])).toBe('2026 年快照')
 })
 it('filters a large release list without changing each record identity',()=>{
  const all=buildCatalog(instances,versions,{...selection,mode:'versions'},id)
  const filtered=buildCatalog(instances,versions,{...selection,mode:'versions',family:'1.20.x'},id)
  expect(filtered.records.map(record=>record.gameVersion)).toEqual(['1.20.6','1.20.1'])
  expect(filtered.records[1].id).toBe(all.records.find(record=>record.gameVersion==='1.20.1')?.id)
  expect(filtered.records[1].lead).toContain('2 个实例')
 })
 it('labels snapshots as tests and warns about worlds instead of recommending them as stable',()=>{
  const result=buildCatalog(instances,versions,{...selection,mode:'versions',channel:'snapshot'},id)
  expect(result.records[0].clearance).toContain('备份')
  expect(result.records[0].recommended).toBe(false)
 })
 it('keeps legacy alpha/beta opt-in',()=>{
  const result=buildCatalog(instances,versions,{...selection,mode:'versions',channel:'history'},id)
  expect(result.records.map(record=>record.gameVersion)).toEqual(['b1.7.3'])
 })
 it('searches names, versions, and loaders',()=>{
  expect(buildCatalog(instances,versions,{...selection,query:'fabric'},id).records.map(r=>r.instanceId)).toEqual(['survival'])
  expect(buildCatalog(instances,versions,{...selection,query:'红石'},id).records[0].instanceId).toBe('technical')
 })
 it('uses a bounded tick window for hundreds of records',()=>{
  const files=Array.from({length:700},(_,i)=>i)
  const window=tickWindow(files,529)
  expect(window).toHaveLength(8);expect(window).toContain(529)
  expect(tickWindow(files,699).at(-1)).toBe(699)
 })
 it('distinguishes loading, genuine empty, and network error without fictional archives',()=>{
  expect(emptyRecord('instances','ready').title).toBe('还没有游戏实例')
  expect(emptyRecord('versions','loading').title).toContain('读取')
  const error=emptyRecord('versions','error','连接超时');expect(error.abstract).toBe('连接超时');expect(error.kind).toBe('empty');expect(error.instanceId).toBeUndefined()
 })
 it('integrates the launch action inside the native article, never an absolutely positioned overlay',()=>{
  const record=instanceRecord(instances[0],'X-001')
  const html=launcherDetailMarkup(record,{accounts:[{id:'account-1',name:'Alex',kind:'offline'}],selectedAccountId:'account-1',pending:false,running:false,status:'已配置'})
  expect(html).toContain('data-main-action');expect(html).toContain('data-action="launch"');expect(html).toContain('和朋友的生存服');expect(html).toContain('Fabric 0.16.9');expect(html).toContain('用于启动的账号');expect(html).not.toContain('launcher-panel');expect(html).not.toContain('研究记录')
 })
 it('never labels an uninstalled version as immediately launchable',()=>{
  const record=buildCatalog([],versions,{...selection,mode:'versions'},id).records[0]
  const html=launcherDetailMarkup(record,{accounts:[],selectedAccountId:null,pending:false,running:false,status:'待配置',draft:{name:'生存服',loader:'fabric',loaderVersion:'',memoryMb:4096},inspection:{loading:false,java:21,loaderLoading:false,builds:[],loaderError:'没有兼容构建'}})
  expect(html).toMatch(/<button[^>]*data-action="create-install"[^>]*\bdisabled/);expect(html).not.toContain('data-action="launch"');expect(html).toContain('没有兼容构建')
 })
})
