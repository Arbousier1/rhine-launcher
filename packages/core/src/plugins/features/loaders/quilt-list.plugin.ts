/**
 * loader.quilt.list: Quilt 加载器版本列表.
 *
 * Single-capability feature: it only lists Quilt builds. Installing is a
 * different plugin so either half can be disabled independently.
 */
import { defineFeature } from '@rhine/plugin-api'
import type { LoaderVersion } from '../../../types.ts'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { listQuiltVersions } from '../../../loader/list.ts'
import { decodeListInput, requireListInput } from './support.ts'

export default defineFeature<{ gameVersion: string }, Promise<LoaderVersion[]>>({
  id: 'loader.quilt.list',
  capability: 'loader.quilt.list',
  title: 'Quilt 加载器版本列表',
  description: '列出指定 Minecraft 版本可用的 Quilt loader 构建',
  tags: ['loader', 'quilt'],
  depends: [LOADER_CAPABILITY.downloadText],
  http: {
    method: 'GET',
    path: '/api/loaders/quilt',
    decode: (request) => decodeListInput(request),
  },
  async execute(input, env) {
    const { gameVersion } = requireListInput(input)
    const host = createLoaderHost(env)
    return listQuiltVersions(host, gameVersion)
  },
})
