/**
 * loader.quilt.install: install one Quilt profile.
 */
import { defineFeature } from '@rhine/plugin-api'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { normalizeQuiltProfile, quiltProfileUrls, quiltVersionId } from '../../../loader/quilt.ts'
import { installProfileVersion } from '../../../loader/profile-install.ts'
import { decodeInstallInput, requireInstallInput } from './support.ts'

export default defineFeature<{ gameVersion: string; loaderVersion: string }, Promise<string>>({
  id: 'loader.quilt.install',
  capability: 'loader.quilt.install',
  title: '安装 Quilt 加载器',
  description: '下载 Quilt profile 并原子写入 versions/<id>/<id>.json',
  tags: ['loader', 'quilt', 'install'],
  depends: [
    LOADER_CAPABILITY.pathsGet,
    LOADER_CAPABILITY.downloadText,
    LOADER_CAPABILITY.versionInstalled,
  ],
  http: {
    method: 'POST',
    path: '/api/loaders/quilt/install',
    decode: (request) => decodeInstallInput(request),
    background: { kind: 'loader-install', title: '安装 Quilt 加载器' },
  },
  execute(input, env) {
    const { gameVersion, loaderVersion } = requireInstallInput(input)
    const host = createLoaderHost(env)
    return installProfileVersion(host, {
      id: quiltVersionId(gameVersion, loaderVersion),
      label: 'Quilt',
      profileUrls: quiltProfileUrls(gameVersion, loaderVersion),
      normalize: (payload) => normalizeQuiltProfile(payload, gameVersion, loaderVersion),
    })
  },
})
