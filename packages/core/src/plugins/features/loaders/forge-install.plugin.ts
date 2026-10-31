/**
 * loader.forge.install: run the official Forge installer.
 *
 * The installer's embedded libraries/processors are prefetched (and verified
 * with publisher hashes + ZIP parsing) before execution; a failed run restores
 * the previous version json or removes the new version directory.
 */
import { defineFeature } from '@rhine/plugin-api'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { forgeInstallerUrls, forgeVersionId } from '../../../loader/forge.ts'
import { installWithInstaller } from '../../../loader/installer.ts'
import { loaderJavaMajor } from '../../../loader/runtime.ts'
import { decodeInstallInput, requireInstallInput } from './support.ts'

export default defineFeature<{ gameVersion: string; loaderVersion: string }, Promise<string>>({
  id: 'loader.forge.install',
  capability: 'loader.forge.install',
  title: '安装 Forge 加载器',
  description: '校验并预取 Forge 安装器依赖后执行 java -jar installer --installClient',
  tags: ['loader', 'forge', 'install'],
  depends: [
    LOADER_CAPABILITY.pathsGet,
    LOADER_CAPABILITY.downloadText,
    LOADER_CAPABILITY.downloadFile,
    LOADER_CAPABILITY.versionVerify,
    LOADER_CAPABILITY.versionInstall,
    LOADER_CAPABILITY.javaPick,
    LOADER_CAPABILITY.javaScan,
  ],
  http: {
    method: 'POST',
    path: '/api/loaders/forge/install',
    decode: (request) => decodeInstallInput(request),
    background: { kind: 'loader-install', title: '安装 Forge 加载器' },
  },
  execute(input, env) {
    const { gameVersion, loaderVersion } = requireInstallInput(input)
    const host = createLoaderHost(env)
    return installWithInstaller(host, {
      kind: 'forge',
      gameVersion,
      loaderVersion,
      label: 'Forge',
      installerUrls: forgeInstallerUrls(gameVersion, loaderVersion),
      expectedVersionId: forgeVersionId(gameVersion, loaderVersion),
      javaMajor: loaderJavaMajor('forge', gameVersion),
    })
  },
})
