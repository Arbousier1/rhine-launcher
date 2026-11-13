import type {FeatureEnvironment} from '@rhine/plugin-api'
import {getLauncherSnapshot,loadLauncher,subscribeStatus,setSelectedAccount,launchInstance,stopInstance,deleteInstance,revealPath,addOfflineAccount} from '../launcher-bridge'
export type Tab='instances'|'downloads'|'settings'
export interface ShellState{tab:Tab;selectedId:string|null;filter:string;detailTab:'overview'|'mods'|'log'|'account'|'java'|'global'|'about';busy:string|null;message:string|null;error:string|null;versionChannel:'release'|'snapshot'|'history';selectedVersion:string|null}
export function createShellState():ShellState{return {tab:'instances',selectedId:null,filter:'',detailTab:'overview',busy:null,message:null,error:null,versionChannel:'release',selectedVersion:null}}
export interface ShellApi{
 state:ShellState
 snapshot:typeof getLauncherSnapshot
 setTab(tab:Tab):void
 select(id:string):void
 rerender():void
 act<T>(label:string,work:()=>Promise<T>):Promise<T|undefined>
 reload():Promise<void>
}
/** Every shell action uses the real capability layer; nothing here invents data. */
export function createShell(env:FeatureEnvironment,render:()=>void):ShellApi{
 const state=createShellState(),api:ShellApi={state,snapshot:getLauncherSnapshot,setTab(tab){state.tab=tab;render()},select(id){state.selectedId=id;render()},rerender:render,
  async act(label,work){state.busy=label;state.error=null;render();try{return await work()}catch(error){state.error=error instanceof Error?error.message:String(error);return undefined}finally{state.busy=null;render()}},
  async reload(){await loadLauncher()},
 }
 return api
}
export {getLauncherSnapshot,subscribeStatus,setSelectedAccount,launchInstance,stopInstance,deleteInstance,revealPath,addOfflineAccount,loadLauncher}
