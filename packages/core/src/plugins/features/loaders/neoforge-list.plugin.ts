/**
 * loader.neoforge.list: NeoForge 加载器版本列表.
 *
 * Single-capability feature: it only lists NeoForge builds. Installing is a
 * different plugin so either half can be disabled independently.
 */
import { defineFeature } from '@rhine/plugin-api'
import type { LoaderVersion } from '../../../types.ts'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { listNeoForgeVersions } from '../../../loader/list.ts'
import { decodeListInput, requireListInput } from './support.ts'

export default defineFeature<{ gameVersion: string }, Promise<LoaderVersion[]>>({
  id: 'loader.neoforge.list',
  capability: 'loader.neoforge.list',
  title: 'NeoForge 加载器版本列表',
  description: '使用 MultiMC 显式 requires 元数据列出 NeoForge 构建（maven 仅作回退）',
  tags: ['loader', 'neoforge'],
  depends: [LOADER_CAPABILITY.downloadText],
  http: {
    method: 'GET',
    path: '/api/loaders/neoforge',
    decode: (request) => decodeListInput(request),
  },
  async execute(input, env) {
    const { gameVersion } = requireListInput(input)
    const host = createLoaderHost(env)
    return listNeoForgeVersions(host, gameVersion)
  },
})
