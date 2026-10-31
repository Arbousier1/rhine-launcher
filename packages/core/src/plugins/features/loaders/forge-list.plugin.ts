/**
 * loader.forge.list: Forge 加载器版本列表.
 *
 * Single-capability feature: it only lists Forge builds. Installing is a
 * different plugin so either half can be disabled independently.
 */
import { defineFeature } from '@rhine/plugin-api'
import type { LoaderVersion } from '../../../types.ts'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { listForgeVersions } from '../../../loader/list.ts'
import { decodeListInput, requireListInput } from './support.ts'

export default defineFeature<{ gameVersion: string }, Promise<LoaderVersion[]>>({
  id: 'loader.forge.list',
  capability: 'loader.forge.list',
  title: 'Forge 加载器版本列表',
  description: '从 Forge maven 元数据列出指定 Minecraft 版本的构建',
  tags: ['loader', 'forge'],
  depends: [LOADER_CAPABILITY.downloadText],
  http: {
    method: 'GET',
    path: '/api/loaders/forge',
    decode: (request) => decodeListInput(request),
  },
  async execute(input, env) {
    const { gameVersion } = requireListInput(input)
    const host = createLoaderHost(env)
    return listForgeVersions(host, gameVersion)
  },
})
