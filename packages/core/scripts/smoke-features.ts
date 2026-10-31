import { mkdtemp,rm } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { createLauncherContext } from '../src/plugins/boot.ts'
const root=await mkdtemp(join(tmpdir(),'rhine-features-'))
try{
 const ctx=await createLauncherContext({root})
 console.log('COUNT',ctx.features.list().length)
 console.log('UNAVAILABLE',JSON.stringify(ctx.features.list().filter(item=>item.status!=='enabled').map(item=>({id:item.id,status:item.status,error:item.error}))))
 console.log('ROOT',ctx.paths.get().root)
 console.log('SETTINGS',ctx.settings.get().concurrency)
 const account=await ctx.accounts.addOffline('FeatureTest')
 console.log('ACCOUNT',account.kind,account.name)
 const instance=await ctx.instances.create({name:'Feature Instance',gameVersion:'1.20.1',loaders:[],memory:{minMb:512,maxMb:2048},jvmArgs:[],gameArgs:[],window:{width:854,height:480,fullscreen:false}})
 console.log('INSTANCE',instance.id,ctx.instances.list().length)
 await ctx.features.disable('file.write')
 console.log('FILE_READ_STILL_ENABLED',ctx.features.has('file.read'))
 await ctx.features.enable('file.write')
 await ctx.instances.writeFile(instance.id,'test.txt','atomic')
 console.log('FILE',await ctx.instances.readFile(instance.id,'test.txt'))
 await ctx.features.disable('auth.microsoft.begin')
 console.log('OFFLINE_STILL_WORKS',(await ctx.accounts.addOffline('OtherTest')).name)
 await ctx.features.dispose()
 console.log('DISPOSED',ctx.features.list().filter(item=>item.status==='enabled').length)
}catch(error){console.error(error);process.exitCode=1}finally{await rm(root,{recursive:true,force:true})}
