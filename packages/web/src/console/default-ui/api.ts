import {nativeRequest,pathId} from '../native-http'
import type {FeatureEnvironment} from '@rhine/plugin-api'
/** Thin read helpers over real HTTP features; no endpoint is invented here. */
export interface SystemInfo{platform:string;arch:string;release:string;cpuModel:string;cpuCount:number;totalMemoryMb:number}
export interface JavaRuntime{path:string;version:string;majorVersion:number;vendor:string;arch:string;managed:boolean}
export async function readSystemInfo(env:FeatureEnvironment,signal:AbortSignal):Promise<SystemInfo>{return nativeRequest<SystemInfo>(env,'/api/system/info',{signal})}
export async function readJavaRuntimes(env:FeatureEnvironment,signal:AbortSignal):Promise<JavaRuntime[]>{return nativeRequest<JavaRuntime[]>(env,'/api/java',{signal})}
export async function scanJava(env:FeatureEnvironment,signal:AbortSignal):Promise<unknown>{return nativeRequest(env,'/api/java/scan',{method:'POST',signal})}
export async function readSettings(env:FeatureEnvironment,signal:AbortSignal):Promise<Record<string,unknown>>{return nativeRequest(env,'/api/settings',{signal})}
export async function updateSettings(env:FeatureEnvironment,patch:Record<string,unknown>,signal:AbortSignal):Promise<unknown>{return nativeRequest(env,'/api/settings',{method:'PATCH',body:patch,signal})}
export async function duplicateInstance(env:FeatureEnvironment,id:string,name:string,signal:AbortSignal):Promise<{id:string}>{return nativeRequest(env,'/api/instances/'+pathId(id)+'/duplicate',{method:'POST',body:{name},signal})}
