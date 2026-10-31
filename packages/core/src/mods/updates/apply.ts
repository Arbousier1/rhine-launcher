import type {FeatureEnvironment} from '@rhine/plugin-api'
import {mkdtemp,rename,rm} from 'node:fs/promises'
import {join} from 'node:path'
import type {ModFile} from '../../types.ts'
import {ModService,modName,withEnabled,withModLock} from '../../services/mods.ts'
import {downloadVerified} from '../../modpack/network.ts'
import {check,fail,fingerprint,maybeStat,object,sameFile,targetPath,text} from '../../modpack/safety.ts'
import {proposals} from './common.ts'

/** Apply only a server-issued checked proposal, retaining disabled state and an undo backup. */
export async function applyUpdate(input:unknown,env:FeatureEnvironment):Promise<ModFile>{
 const body=object(input),id=text(body.id??body.instanceId,'实例 id'),updateId=text(body.updateId,'更新 id')
 return withModLock(env,id,async()=>{
  const proposal=proposals(env).get(updateId)
  if(!proposal||proposal.instanceId!==id||proposal.expires<Date.now())fail('更新检查结果已过期或不属于该实例，请重新检查','UPDATE_EXPIRED',409)
  if(body.diskName&&body.diskName!==proposal.diskName)fail('更新的本地文件名不匹配','FILE_CHANGED',409)
  const mods=new ModService(env),directory=(await mods.modsDirectory(id,true))!
  const current=await targetPath(directory,modName(proposal.diskName))
  const before=await fingerprint(current,env)
  if(!sameFile(proposal.old,before)||proposal.old.hashes.sha256!==before.hashes.sha256)fail('模组在检查更新后已改变，请重新检查','FILE_CHANGED',409)
  const enabled=!proposal.diskName.toLowerCase().endsWith('.disabled')
  const newName=withEnabled(modName(proposal.fileName),enabled)
  const target=await targetPath(directory,newName)
  if(target.toLowerCase()!==current.toLowerCase()&&await maybeStat(target))fail('更新目标文件已存在','FILE_EXISTS',409)
  const stage=await mkdtemp(join(directory,'.update-')),backup=join(stage,'previous.backup')
  const downloaded=join(stage,proposal.fileName)
  let backedUp=false,committed=false
  try{
    await downloadVerified(stage,{path:proposal.fileName,url:proposal.downloadUrl,hashes:proposal.hashes,size:proposal.size},env)
    await mods.inspectArchive(downloaded)
    check(env)
    if(!sameFile(before,await fingerprint(current,env)))fail('模组在下载期间已改变','FILE_CHANGED',409)
    await targetPath(directory,newName)
    check(env)
    await rename(current,backup);backedUp=true
    check(env)
    await rename(downloaded,target);committed=true
    const result=await mods.describe(target)
    proposals(env).delete(updateId)
    env.task?.setProgress({stage:'done',value:1,message:'模组更新完成：'+newName})
    return result
  }catch(error){
    if(backedUp){
      if(committed)await rm(target,{force:true})
      await rename(backup,current)
    }
    throw error
  }finally{
    // A committed old version remains in the backup until every subsequent
    // operation succeeded; errors restore it before removing staging.
    await rm(stage,{recursive:true,force:true})
  }
 })
}
