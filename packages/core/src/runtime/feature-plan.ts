import {classifyLoaderAttachment} from '../loader/versions.ts'
import { FeatureError, type FeatureEnvironment } from '@rhine/plugin-api'
import { join } from 'node:path'
import { readFile, stat } from 'node:fs/promises'
import type { Account, Instance, JavaRuntime, LaunchRequest, Settings } from '../types.ts'
import type { RawVersionJson, RhPaths } from '../contracts.ts'
import { identifier, object, string } from '../plugins/http-input.ts'
import { buildCommand, classpathFromPlans, planLibraries } from './command.ts'
import { currentPlatform } from './rules.ts'
import { requiredJavaMajor } from '../services/launch.ts'

export interface PreparedFeatureLaunch {
  instance:Instance
  request:LaunchRequest
  account:Account
  version:RawVersionJson
  command:string[]
  cwd:string
  mainClass:string
}

export function parseLaunch(input:unknown):LaunchRequest {
  const body=object(input)
  return {...body,instanceId:identifier(body.instanceId,'实例 id'),accountId:string(body.accountId,'账号 id')} as LaunchRequest
}

/** Match a loader's own profile rather than guessing from lexical substring order. */
export async function selectedVersion(instance:Instance,env:FeatureEnvironment):Promise<string> {
  const attachments=(instance.loaders??[]).filter(loader=>loader.kind!=='vanilla')
  if(attachments.length>1)throw new FeatureError('INCOMPATIBLE_LOADERS','当前实例同时指定多个加载器；请使用已验证的组合版本而不是静默回退原版',400)
  if(!attachments.length)return instance.gameVersion
  const loader=attachments[0]
  const ids=env.use<Promise<string[]>>('version.installed')
  for(const id of await ids){
    const json=await env.use<Promise<RawVersionJson>>('version.get',{id})
    if(json.inheritsFrom!==instance.gameVersion)continue
    const attachment=classifyLoaderAttachment({id,inheritsFrom:json.inheritsFrom,json,file:''})
    if(attachment?.kind!==loader.kind)continue
    if(loader.version&&attachment.version!==loader.version&&attachment.version!==instance.gameVersion+'-'+loader.version)continue
    return id
  }
  throw new FeatureError('LOADER_NOT_INSTALLED','未安装所选加载器：'+loader.kind+' '+(loader.version??''),409)
}

/** One preparation workflow, with all platform/install actions independently replaceable. */
export async function prepareFeatureLaunch(input:unknown,env:FeatureEnvironment,preview:boolean):Promise<PreparedFeatureLaunch> {
  const request=parseLaunch(input)
  const instance=env.use<Instance|undefined>('instance.get',{id:request.instanceId})
  if(!instance)throw new FeatureError('INSTANCE_NOT_FOUND','实例不存在：'+request.instanceId,404)
  if(!preview){
    const installed=await env.use<Promise<boolean>>('version.verify',{id:instance.gameVersion})
    if(!installed)await env.use<Promise<void>>('version.install',{gameVersion:instance.gameVersion})
  }
  let versionId:string
  try { versionId=await env.use<Promise<string>>('version.select',{instance}) }
  catch(error){
    if(preview||!(error instanceof FeatureError)||error.code!=='LOADER_NOT_INSTALLED')throw error
    const loader=instance.loaders.find(item=>item.kind!=='vanilla')!
    if(!loader.version)throw new FeatureError('LOADER_VERSION_REQUIRED','请先选择加载器版本',400)
    versionId=await env.use<Promise<string>>('loader.'+loader.kind+'.install',{gameVersion:instance.gameVersion,loaderVersion:loader.version})
  }
  const version=await env.use<Promise<RawVersionJson>>('version.resolve',{id:versionId})
  const account=preview
    ? env.use<Account|undefined>('account.get',{id:request.accountId})
    : await env.use<Promise<Account>>('account.authorize',{id:request.accountId})
  if(!account)throw new FeatureError('ACCOUNT_NOT_FOUND','账号不存在：'+request.accountId,404)
  const required=requiredJavaMajor(version,instance.gameVersion)
  const preferred=request.javaPath||instance.javaPath
  let java=env.use<JavaRuntime|undefined>('java.pick',{majorVersion:required,preferred})
  if(!preview&&(!java||java.majorVersion<required||preferred&&java.path!==preferred)){
    await env.use<Promise<JavaRuntime[]>>('java.scan')
    java=env.use<JavaRuntime|undefined>('java.pick',{majorVersion:required,preferred})
  }
  if(!java||java.majorVersion<required||preferred&&java.path!==preferred){
    if(preview)throw new FeatureError('JAVA_NOT_READY','尚未配置可用 Java '+required+'，请先扫描或安装运行时',409)
    const settings=env.use<Settings>('settings.resolve')
    if(preferred||!settings.autoDownloadJava)throw new FeatureError('JAVA_NOT_READY','指定的 Java 不可用或版本低于 '+required,409)
    const component=version.javaVersion?.component??(required<=8?'jre-legacy':required<=16?'java-runtime-alpha':required<=17?'java-runtime-gamma':required<=21?'java-runtime-delta':'java-runtime-epsilon')
    java=await env.use<Promise<JavaRuntime>>('java.install',{component})
    if(java.majorVersion<required)throw new FeatureError('JAVA_VERSION_MISMATCH','下载的运行时无法运行所选 Minecraft 版本',409)
  }
  const paths=env.use<RhPaths>('paths.get')
  const platform=currentPlatform()
  const plans=planLibraries(version.libraries,platform,paths.libraries)
  const jarId=typeof version.jar==='string'?identifier(version.jar,'客户端 jar id'):identifier(versionId)
  const jar=join(paths.versions,jarId,jarId+'.jar')
  if(!preview){
    for(const capability of ['minecraft.libraries.install','minecraft.assets.install','minecraft.logging.install'])await env.use<Promise<void>>(capability,{version})
    if(!(await stat(jar).catch(()=>undefined))?.isFile())throw new FeatureError('CLIENT_JAR_MISSING','找不到客户端文件：'+jarId,409)
    await env.use<Promise<void>>('minecraft.natives.extract',{instanceId:instance.id,version})
  }
  const natives=join(instance.path,'natives')
  const extraJvm=[...(request.extraJvmArgs??[])]
  if(account.kind==='authlib-injector'){
    if(!account.authServerUrl)throw new FeatureError('INVALID_ACCOUNT','外置账号缺少认证服务器',400)
    const agentPath=preview?join(paths.libraries,'authlib-injector','authlib-injector.jar'):await env.use<Promise<string>>('auth.agent.prepare',{authServerUrl:account.authServerUrl})
    extraJvm.push('-javaagent:'+agentPath+'='+account.authServerUrl)
  }
  const logging=version.logging?.client?.file
  const command=buildCommand({
    version,versionName:versionId,instance,gameDir:instance.path,assetsDir:paths.assets,librariesDir:paths.libraries,
    classpath:classpathFromPlans(plans,jar),versionJar:jar,nativesDir:natives,javaPath:java.path,javaMajor:java.majorVersion,
    memory:{minMb:instance.memory.minMb,maxMb:request.memoryMb??instance.memory.maxMb},window:instance.window,
    jvmExtra:extraJvm,gameExtra:request.extraGameArgs,auth:{username:account.name,uuid:account.uuid.replace(/-/g,''),accessToken:account.accessToken??'0',userType:account.kind==='microsoft'?'msa':account.kind==='authlib-injector'?'mojang':'legacy',clientId:account.microsoftClientId,xuid:(account as any).xuid,userProperties:'{}'},
    launcher:{name:'Rhine Launcher',version:'0.2.0'},loggingFile:logging?join(paths.assets,'log_configs',identifier(logging.id)):undefined,platform,versionType:version.type,
  })
  env.signal.throwIfAborted()
  return {instance,request,account,version,command:command.command,cwd:instance.path,mainClass:command.mainClass}
}

/** Access tokens are never part of HTTP previews, session snapshots or log headers. */
export function redactCommand(command:readonly string[],secrets:readonly string[]=[]):string[]{
  let secretNext=false
  return command.map(arg=>{
    if(secretNext){secretNext=false;return '<redacted>'}
    if(['--accessToken','--clientToken','--refreshToken'].includes(arg)){secretNext=true;return arg}
    let out=arg
    for(const secret of secrets)if(secret&&secret!=='0')out=out.split(secret).join('<redacted>')
    return out
  })
}
