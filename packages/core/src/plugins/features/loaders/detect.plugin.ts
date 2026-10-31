/**
 * loader.detect: list loader attachments installed for a game version.
 *
 * Detection reads every versions/<id>/<id>.json and classifies by id *and*
 * library names, because NeoForge 1.20.1 shares Forge's id scheme.
 */
import { defineFeature } from '@rhine/plugin-api'
import type { LoaderSpec } from '../../../types.ts'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { detectLoaderAttachments, readInstalledVersions } from '../../../loader/versions.ts'
import { decodeDetectInput, requireListInput } from './support.ts'

export default defineFeature<{ gameVersion: string }, Promise<LoaderSpec[]>>({
  id: 'loader.detect',
  capability: 'loader.detect',
  title: '检测已安装加载器',
  description: '扫描 versions 目录并识别 Fabric/Quilt/Forge/NeoForge/OptiFine 附件',
  tags: ['loader', 'detect'],
  depends: [LOADER_CAPABILITY.pathsGet],
  http: {
    method: 'GET',
    path: '/api/versions/:gameVersion/loaders',
    decode: (request, params) => decodeDetectInput(request, params),
  },
  async execute(input, env) {
    const { gameVersion } = requireListInput(input)
    const host = createLoaderHost(env)
    const versions = await readInstalledVersions(host.paths().versions)
    return detectLoaderAttachments(versions, gameVersion)
  },
})
