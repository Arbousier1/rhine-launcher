/**
 * loader.fabric.list: Fabric 加载器版本列表.
 *
 * Single-capability feature: it only lists Fabric builds. Installing is a
 * different plugin so either half can be disabled independently.
 */
import { defineFeature } from '@rhine/plugin-api'
import type { LoaderVersion } from '../../../types.ts'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { listFabricVersions } from '../../../loader/list.ts'
import { decodeListInput, requireListInput } from './support.ts'

export default defineFeature<{ gameVersion: string }, Promise<LoaderVersion[]>>({
  id: 'loader.fabric.list',
  capability: 'loader.fabric.list',
  title: 'Fabric 加载器版本列表',
  description: '列出指定 Minecraft 版本可用的 Fabric loader 构建',
  tags: ['loader', 'fabric'],
  depends: [LOADER_CAPABILITY.downloadText],
  http: {
    method: 'GET',
    path: '/api/loaders/fabric',
    decode: (request) => decodeListInput(request),
  },
  async execute(input, env) {
    const { gameVersion } = requireListInput(input)
    const host = createLoaderHost(env)
    return listFabricVersions(host, gameVersion)
  },
})
