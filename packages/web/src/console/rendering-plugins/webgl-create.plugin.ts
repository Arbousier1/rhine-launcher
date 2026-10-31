import {defineFeature} from '@rhine/plugin-api'
import {WebGLArchiveBackend} from '../rendering/webgl-backend'
import {setupRendererFeature,ownRendererFactory} from '../rendering/ownership'
import type {ArchiveBackendFactory} from '../rendering/backend'
export default defineFeature<void,ArchiveBackendFactory>({id:'renderer.webgl.create',capability:'renderer.webgl.create',title:'创建完整 WebGL 兼容渲染器',setup:env=>setupRendererFeature(env,'webgl2'),execute:(_input,env)=>ownRendererFactory(env,'webgl2',(host,scene,camera,look)=>new WebGLArchiveBackend(host,scene,camera,look))})
