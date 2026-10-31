/**
 * loader.fabric.install: install one Fabric profile.
 *
 * Downloading/installing is a separate capability from listing, so disabling
 * the Fabric install plugin leaves Quilt/Forge/NeoForge and detect untouched.
 */
import { defineFeature } from '@rhine/plugin-api'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { fabricProfileUrls, fabricVersionId, normalizeFabricProfile } from '../../../loader/fabric.ts'
import { installProfileVersion } from '../../../loader/profile-install.ts'
import { decodeInstallInput, requireInstallInput } from './support.ts'

export default defineFeature<{ gameVersion: string; loaderVersion: string }, Promise<string>>({
  id: 'loader.fabric.install',
  capability: 'loader.fabric.install',
  title: '安装 Fabric 加载器',
  description: '下载 Fabric profile 并原子写入 versions/<id>/<id>.json',
  tags: ['loader', 'fabric', 'install'],
  depends: [
    LOADER_CAPABILITY.pathsGet,
    LOADER_CAPABILITY.downloadText,
    LOADER_CAPABILITY.versionInstalled,
  ],
  http: {
    method: 'POST',
    path: '/api/loaders/fabric/install',
    decode: (request) => decodeInstallInput(request),
    background: { kind: 'loader-install', title: '安装 Fabric 加载器' },
  },
  execute(input, env) {
    const { gameVersion, loaderVersion } = requireInstallInput(input)
    const host = createLoaderHost(env)
    return installProfileVersion(host, {
      id: fabricVersionId(gameVersion, loaderVersion),
      label: 'Fabric',
      profileUrls: fabricProfileUrls(gameVersion, loaderVersion),
      normalize: (payload) => normalizeFabricProfile(payload, gameVersion, loaderVersion),
    })
  },
})
