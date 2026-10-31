/** Test-only port adapters: production still dispatches real single-feature descriptors. */
import {Context} from '@deepseek-ai/cordis'
import {FeatureRuntime,FeatureError} from '@rhine/plugin-api'
import {discoverFeatures} from '../../core/src/plugins/catalog.ts'
import type {FeaturePlugin} from '@rhine/plugin-api'

export function testRuntime(ports:any):FeatureRuntime {
 const runtime=new FeatureRuntime(new Context())
 const operation=(id:string):((input:any)=>any)|undefined=>{
  if(id==='loader.vanilla.list')return undefined
  const plain:Record<string,()=>any>={
    'paths.get':()=>ports.paths.get(),'paths.ensure':()=>ports.paths.ensure(),
    'settings.get':()=>ports.settings.get(),'settings.resolve':()=>ports.settings.resolved(),
    'task.list':()=>ports.tasks.list(),'task.clear':()=>ports.tasks.clear(),
    'version.list':async()=>{const versions=await ports.meta.remoteVersions();return ports.settings.get().showSnapshots?versions:versions.filter((v:any)=>v.type!=='snapshot')},'version.installed':()=>ports.meta.installed(),
    'instance.list':()=>ports.instances.list(),'account.list':()=>ports.accounts.list(),
    'java.list':()=>ports.java.cached(),'java.scan':()=>ports.java.scan(),
    'session.list':()=>ports.launch.sessions(),'auth.microsoft.begin':()=>ports.accounts.beginMicrosoft(),
    'auth.microsoft.complete':()=>ports.accounts.completeMicrosoft(),
  }
  if(plain[id])return plain[id]
  const actions:Record<string,(input:any)=>any>={
    'storage.read':x=>ports.storage.read(x.file,x.fallback),'storage.read.sync':x=>ports.storage.readSync(x.file,x.fallback),'storage.write':x=>ports.storage.write(x.file,x.value),
    'settings.update':x=>ports.settings.update(x),'events.emit':x=>ports.bus.emit(x),'events.subscribe':x=>ports.bus.subscribe(x),
    'task.submit':x=>ports.tasks.run(x.title,x.kind,x.body),'task.get':x=>ports.tasks.get(x.id),'task.cancel':x=>{const ok=ports.tasks.cancel(x.id);if(!ok)throw new FeatureError('NOT_FOUND','任务不存在',404);return ok},'task.wait':x=>ports.tasks.wait(x.id),
    'version.get':x=>ports.meta.versionJson(x.id),'version.entry':x=>ports.meta.remoteVersion(x.id),'version.chain':x=>ports.meta.versionChain(x.id),'version.resolve':x=>ports.meta.resolvedJson(x.id),'version.install':x=>ports.meta.install(x.gameVersion),'version.verify':x=>ports.meta.isInstalled(x.id),
    'instance.get':x=>ports.instances.get(x.id),'instance.create':x=>ports.instances.create(x),'instance.update':x=>ports.instances.update(x.id,x.patch),'instance.remove':x=>ports.instances.remove(x.id,x.options),'instance.duplicate':x=>ports.instances.duplicate(x.id,x.name),
    'file.list':x=>ports.instances.files(x.id,x.subdir),'file.read':x=>ports.instances.readFile(x.id,x.path),'file.write':x=>ports.instances.writeFile(x.id,x.path,x.content),'file.remove':x=>ports.instances.deleteFile(x.id,x.path),
    'account.get':x=>ports.accounts.get(x.id),'account.remove':x=>ports.accounts.remove(x.id),'auth.offline.login':x=>ports.accounts.addOffline(x.name),
    'account.refresh':x=>ports.accounts.refresh(x.id),'account.authorize':x=>ports.accounts.authorize(x.id),
    'java.pick':x=>ports.java.pick(x.majorVersion,x.preferred),'java.install':x=>ports.java.install(x.component),
    'session.get':x=>ports.launch.session(x.id),'session.stop':x=>ports.launch.kill(x.id),'session.log':x=>{if(!ports.launch.session(x.id))throw new FeatureError('NOT_FOUND','会话不存在',404);return {sessionId:x.id,lines:ports.launch.log(x.id,x.tail)}},
    'launch.start':x=>ports.launch.launch(x),'launch.build':x=>ports.launch.buildCommand(x),
    'mod.list':x=>ports.mods.list(x.id??x.instanceId),'mod.toggle':async x=>{const mods=await ports.mods.list(x.id??x.instanceId);const mod=mods.find((m:any)=>m.diskName===x.diskName);if(!mod)throw new FeatureError('NOT_FOUND','模组不存在',404);return ports.mods.setEnabled(x.id??x.instanceId,x.diskName,x.enabled??!mod.enabled)},'mod.remove':x=>ports.mods.remove(x.id??x.instanceId,x.diskName),'mod.install':x=>ports.mods.install(x.id??x.instanceId,x.url,x.fileName),
    'diagnostics.analyze':x=>ports.diagnostics?ports.diagnostics.analyze(x.id):[],
    'market.search':x=>ports.market.search(x),'market.install':x=>ports.market.install(x.instanceId,x.version),
    'loader.detect':x=>ports.loader.detect(x.gameVersion),
  }
  if(actions[id])return actions[id]
  const loader=/^loader[.]([^.]+)[.](list|install)$/.exec(id)
  if(loader)return x=>loader[2]==='list'?ports.loader.versions(loader[1],x.gameVersion):ports.loader.install(loader[1],x.gameVersion,x.loaderVersion)
  const market=/^market[.]([^.]+)[.](search|project|versions|install)$/.exec(id)
  if(market)return x=>market[2]==='search'?ports.market.search({...x,source:market[1]}):market[2]==='project'?ports.market.project(market[1],x.id??x.projectId):market[2]==='versions'?ports.market.versions(market[1],x.projectId??x.id,x.filter):ports.market.install(x.instanceId,x.version)
  return undefined
 }
 void runtime.load(discoverFeatures().then(entries=>entries.map(entry=>{
  const execute=operation(entry.plugin.id)
  return execute?{...entry,plugin:{...entry.plugin,depends:[],optionalDepends:[],setup:undefined,execute} as FeaturePlugin}:entry
 })))
 return runtime
}
