import {defineFeature} from '@rhine/plugin-api'
import {setSelectedAccount,addOfflineAccount,revealPath} from '../../launcher-bridge'
import {readSystemInfo,readJavaRuntimes,scanJava,readSettings,updateSettings} from '../api'
import {createSettingsState,settingsMain,type SettingsState} from '../settings'
import {shellApi} from '../shell-state'
import {mountSurface,type SurfaceHandle,type SurfaceInput} from './shared'
import {contributeSurface} from '../slots'

/** Settings surface: accounts, Java, global preferences and host facts. */
export default defineFeature<SurfaceInput,SurfaceHandle>({
 id:'surface.settings',capability:'surface.settings',title:'设置页面（账户、Java 与全局选项）',
 optionalDepends:['launcher.bootstrap','launcher.account.offline','launcher.system.reveal'],
 setup(env){contributeSurface(env,{capability:'surface.settings',labelKey:'nav.settings',order:30})},
 execute(input,env){
  env.signal.throwIfAborted()
  const settings:SettingsState=createSettingsState()
  return mountSurface(env,input,(rerender,signal)=>{
   const api=shellApi(env,rerender,signal)
   const load=async()=>{try{
    const [info,java,prefs]=await Promise.all([readSystemInfo(env,signal),readJavaRuntimes(env,signal),readSettings(env,signal)])
    settings.system=info;settings.java=java;settings.settings=prefs
   }catch(error){if(!signal.aborted)settings.error=error instanceof Error?error.message:String(error)}
   rerender()}
   input.root.addEventListener('click',(event:Event)=>{
    const button=(event.target as Element).closest<HTMLButtonElement>('button');if(!button||!input.root.contains(button))return
    if(button.dataset.settingsTab){api.state.detailTab=button.dataset.settingsTab as never;rerender();return}
    if(button.dataset.accountSelect){void api.act('切换账户',async()=>{setSelectedAccount(button.dataset.accountSelect!)}) ;return}
    const action=button.dataset.action
    if(action==='add-offline'){const name=settings.offlineName.trim()
     void api.act('添加账户',async()=>{if(!/^[A-Za-z0-9_]{1,16}$/.test(name))throw new Error('离线用户名需为 1–16 位字母、数字或下划线')
      await addOfflineAccount(name);settings.offlineName='';settings.message='已添加离线账户：'+name});return}
    if(action==='scan-java'){void api.act('检测 Java',async()=>{await scanJava(env,signal);await load()});return}
    if(action==='reveal'){const path=button.dataset.path;if(path)void api.act('打开文件夹',()=>revealPath(path));return}
    if(action==='account-microsoft'||action==='account-external'){settings.message='微软与外置登录将在此后接入统一账户能力，当前未启用。';rerender();return}
   },{signal})
   input.root.addEventListener('input',(event:Event)=>{
    const target=event.target as HTMLInputElement
    if(target.dataset.offlineName!==undefined)settings.offlineName=target.value
   },{signal})
   input.root.addEventListener('change',(event:Event)=>{
    const target=event.target as HTMLSelectElement
    if(!target.dataset.setting)return
    const key=target.dataset.setting,value=key==='autoDownloadJava'?target.value==='true':target.value
    void api.act('保存设置',async()=>{await updateSettings(env,{[key]:value} as Record<string,unknown>,signal);await load();settings.message='设置已保存'})
   },{signal})
   void load()
   input.root.innerHTML='<div class="dft-main-body">'+settingsMain(api,settings)+'</div>'
  })
 }
})
