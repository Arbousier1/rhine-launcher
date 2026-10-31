/**
 * loader.optifine.list: OptiFine 版本列表.
 *
 * Single-capability feature: it only lists OptiFine builds. Installing is a
 * different plugin so either half can be disabled independently.
 */
import { defineFeature } from '@rhine/plugin-api'
import type { LoaderVersion } from '../../../types.ts'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { listOptiFineVersions } from '../../../loader/list.ts'
import { decodeListInput, requireListInput } from './support.ts'

export default defineFeature<{ gameVersion: string }, Promise<LoaderVersion[]>>({
  id: 'loader.optifine.list',
  capability: 'loader.optifine.list',
  title: 'OptiFine 版本列表',
  description: '列出 OptiFine 正式版与预览版（含 HD_U_I5_pre4）',
  tags: ['loader', 'optifine'],
  depends: [LOADER_CAPABILITY.downloadText],
  http: {
    method: 'GET',
    path: '/api/loaders/optifine',
    decode: (request) => decodeListInput(request),
  },
  async execute(input, env) {
    const { gameVersion } = requireListInput(input)
    const host = createLoaderHost(env)
    return listOptiFineVersions(host, gameVersion)
  },
})
