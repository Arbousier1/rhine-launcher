/**
 * loader.neoforge.install: run the official NeoForge installer.
 *
 * 1.20.1 uses net.neoforged:forge:1.20.1-47.x and generates
 * '1.20.1-forge-47.x'; modern builds use net.neoforged:neoforge:<20.x+>.
 */
import { defineFeature } from '@rhine/plugin-api'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { installWithInstaller } from '../../../loader/installer.ts'
import { neoforgeInstallerUrls, neoforgeVersionId } from '../../../loader/neoforge.ts'
import { loaderJavaMajor } from '../../../loader/runtime.ts'
import { decodeInstallInput, requireInstallInput } from './support.ts'

export default defineFeature<{ gameVersion: string; loaderVersion: string }, Promise<string>>({
  id: 'loader.neoforge.install',
  capability: 'loader.neoforge.install',
  title: '安装 NeoForge 加载器',
  description: '按 1.20.1/现代两套 Maven 坐标校验并预取依赖后执行 NeoForge 安装器',
  tags: ['loader', 'neoforge', 'install'],
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
    path: '/api/loaders/neoforge/install',
    decode: (request) => decodeInstallInput(request),
    background: { kind: 'loader-install', title: '安装 NeoForge 加载器' },
  },
  execute(input, env) {
    const { gameVersion, loaderVersion } = requireInstallInput(input)
    const host = createLoaderHost(env)
    return installWithInstaller(host, {
      kind: 'neoforge',
      gameVersion,
      loaderVersion,
      label: 'NeoForge',
      installerUrls: neoforgeInstallerUrls(gameVersion, loaderVersion),
      expectedVersionId: neoforgeVersionId(gameVersion, loaderVersion),
      javaMajor: loaderJavaMajor('neoforge', gameVersion),
    })
  },
})
