import { FeatureRuntime } from '@rhine/plugin-api'
import type { ProjectionAction } from '@rhine/plugin-api'

const plain=(feature:string,input?:(args:any[])=>unknown,output?:(result:any)=>unknown):ProjectionAction=>({feature,input:input as ProjectionAction['input'],output})
const id=(args:any[])=>({id:args[0]})
/** Old namespaces are projections, never multi-function plugins or implementations. */
export function installProjections(runtime:FeatureRuntime):void {
  runtime.project('paths',{
    get:plain('paths.get',()=>undefined),instance:plain('paths.instance',id),ensure:plain('paths.ensure',()=>undefined),reset:plain('paths.reset',a=>({root:a[0]})),
  })
  runtime.project('storage',{
    read:plain('storage.read',a=>({file:a[0],fallback:a[1]})),readSync:plain('storage.read.sync',a=>({file:a[0],fallback:a[1]})),write:plain('storage.write',a=>({file:a[0],value:a[1]})),
  })
  runtime.project('settings',{
    get:plain('settings.get',()=>undefined),resolved:plain('settings.resolve',()=>undefined),update:plain('settings.update'),relocate:plain('settings.relocate',a=>({root:a[0]})),
  })
  runtime.project('bus',{emit:plain('events.emit'),subscribe:plain('events.subscribe')})
  runtime.project('tasks',{
    run:plain('task.submit',a=>({title:a[0],kind:a[1],body:a[2]})),list:plain('task.list',()=>undefined),get:plain('task.get',id),cancel:plain('task.cancel',id),clear:plain('task.clear',()=>undefined),wait:plain('task.wait',id),
  })
  runtime.project('download',{
    file:plain('download.file'),batch:plain('download.batch',a=>({items:a[0],handle:a[1],concurrency:a[2]})),
    text:plain('download.text',a=>a[1]?{url:a[0],options:a[1]}:a[0]),buffer:plain('download.buffer',a=>a[1]?{url:a[0],options:a[1]}:a[0]),
  })
  runtime.project('meta',{
    remoteVersions:plain('version.list',()=>undefined),remoteVersion:plain('version.entry',id),versionJson:plain('version.get',id),versionChain:plain('version.chain',id),resolvedJson:plain('version.resolve',id),installed:plain('version.installed',()=>undefined),install:plain('version.install',a=>({gameVersion:a[0],handle:a[1]})),isInstalled:plain('version.verify',id),
  })
  runtime.project('loader',{
    versions:{feature:a=>'loader.'+a[0]+'.list',input:a=>({gameVersion:a[1]})},
    install:{feature:a=>'loader.'+a[0]+'.install',input:a=>({gameVersion:a[1],loaderVersion:a[2],handle:a[3]})},
    detect:plain('loader.detect',a=>({gameVersion:a[0]})),
  })
  runtime.project('java',{
    scan:plain('java.scan',()=>undefined),cached:plain('java.list',()=>undefined),pick:plain('java.pick',a=>({majorVersion:a[0],preferred:a[1]})),install:plain('java.install',a=>({component:a[0],handle:a[1]})),
  })
  runtime.project('accounts',{
    list:plain('account.list',()=>undefined),get:plain('account.get',id),addOffline:plain('auth.offline.login',a=>({name:a[0]})),addAuthlibInjector:plain('auth.yggdrasil.login',a=>({authServerUrl:a[0],username:a[1],password:a[2]})),remove:plain('account.remove',id),beginMicrosoft:plain('auth.microsoft.begin'),completeMicrosoft:plain('auth.microsoft.complete'),refresh:plain('account.refresh',id),authorize:plain('account.authorize',id),
  })
  runtime.project('instances',{
    list:plain('instance.list',()=>undefined),get:plain('instance.get',id),create:plain('instance.create'),update:plain('instance.update',a=>({id:a[0],patch:a[1]})),remove:plain('instance.remove',a=>({id:a[0],options:a[1]})),duplicate:plain('instance.duplicate',a=>({id:a[0],name:a[1]})),
    importModpack:plain('modpack.import',a=>({path:a[0],name:a[1],handle:a[2]})),files:plain('file.list',a=>({id:a[0],subdir:a[1]})),readFile:plain('file.read',a=>({id:a[0],path:a[1]})),writeFile:plain('file.write',a=>({id:a[0],path:a[1],content:a[2]})),deleteFile:plain('file.remove',a=>({id:a[0],path:a[1]})),markLaunched:plain('instance.mark-launched',id),addPlayTime:plain('instance.add-playtime',a=>({id:a[0],elapsedMs:a[1]})),
  })
  runtime.project('mods',{
    list:plain('mod.list',a=>({id:a[0],instanceId:a[0]})),setEnabled:plain('mod.toggle',a=>({id:a[0],instanceId:a[0],diskName:a[1],enabled:a[2]})),remove:plain('mod.remove',a=>({id:a[0],instanceId:a[0],diskName:a[1]})),install:plain('mod.install',a=>({id:a[0],instanceId:a[0],url:a[1],fileName:a[2],handle:a[3]})),inspect:plain('mod.inspect',a=>({path:a[0],jarPath:a[0]})),checkUpdates:plain('mod.update.modrinth.check',a=>({id:a[0],instanceId:a[0]})),
  })
  runtime.project('market',{
    search:{feature:a=>'market.'+((a[0] as any).source||'modrinth')+'.search',input:a=>a[0]},
    project:{feature:a=>'market.'+a[0]+'.project',input:a=>({id:a[1],projectId:a[1]})},
    versions:{feature:a=>'market.'+a[0]+'.versions',input:a=>({projectId:a[1],filter:a[2]})},
    install:plain('market.install',a=>({instanceId:a[0],version:a[1],handle:a[2]})),
  })
  runtime.project('launch',{
    launch:plain('launch.start'),buildCommand:plain('launch.build'),sessions:plain('session.list',()=>undefined),session:plain('session.get',id),kill:plain('session.stop',id),log:plain('session.log',a=>({id:a[0],tail:a[1]}),result=>Array.isArray(result)?result:result.lines),
  })
  runtime.project('diagnostics',{analyze:plain('diagnostics.analyze',id)})
}
