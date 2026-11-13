import type {FeatureEnvironment} from '@rhine/plugin-api'
import {getLauncherSnapshot,loadLauncher} from '../launcher-bridge'
import type {ShellApi,ShellState} from './state'
/**
 * Shared shell data: a plain non-plugin store. DSH keeps shared data capability-
 * free, so surfaces read it and mutate it only through declared features.
 */
export function shellState(env:FeatureEnvironment):ShellState{
 return env.state<ShellState>('launcher.shell.state',()=>({tab:'instances',selectedId:null,filter:'',detailTab:'overview',busy:null,message:null,error:null,versionChannel:'release',selectedVersion:null}))
}
export function shellApi(env:FeatureEnvironment,render:()=>void,signal:AbortSignal):ShellApi{
 const state=shellState(env)
 return {state,snapshot:getLauncherSnapshot,
  setTab(tab){state.tab=tab;render()},
  select(id){state.selectedId=id;render()},
  rerender:render,
  async act(label,work){state.busy=label;state.error=null;render()
   try{return await work()}
   catch(error){if(!signal.aborted)state.error=error instanceof Error?error.message:String(error);return undefined}
   finally{state.busy=null;render()}},
  async reload(){await loadLauncher()}}
}
