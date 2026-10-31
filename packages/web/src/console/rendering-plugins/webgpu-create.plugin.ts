import {defineFeature} from '@rhine/plugin-api'
import {setupRendererFeature,ownRendererFactory} from '../rendering/ownership'
import type {ArchiveBackendFactory} from '../rendering/backend'
export default defineFeature<{signal?:AbortSignal}|undefined,Promise<ArchiveBackendFactory>>({id:'renderer.webgpu.create',capability:'renderer.webgpu.create',title:'创建原生 WebGPU 渲染器',setup:env=>setupRendererFeature(env,'webgpu'),async execute(input,env){const signal=input?.signal?AbortSignal.any([env.signal,input.signal]):env.signal;const {createWebGPUBackendFactory}=await import('../rendering/webgpu/backend');signal.throwIfAborted();return ownRendererFactory(env,'webgpu',await createWebGPUBackendFactory(signal))}})
