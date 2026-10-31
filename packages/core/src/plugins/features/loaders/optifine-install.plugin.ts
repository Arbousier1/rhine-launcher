/**
 * loader.optifine.install: install OptiFine with the real Patcher.
 *
 * Extracts the embedded launchwrapper, runs
 * 'optifine.Patcher <base client.jar> <installer.jar> <out.jar>' and writes an
 * inheriting version json whose mainClass is launchwrapper's Launch with the
 * '--tweakClass optifine.OptiFineTweaker' argument.
 */
import { defineFeature } from '@rhine/plugin-api'
import { createLoaderHost, LOADER_CAPABILITY } from '../../../loader/capabilities.ts'
import { installOptiFine } from '../../../loader/optifine-install.ts'
import { decodeInstallInput, requireInstallInput } from './support.ts'

export default defineFeature<{ gameVersion: string; loaderVersion: string }, Promise<string>>({
  id: 'loader.optifine.install',
  capability: 'loader.optifine.install',
  title: '安装 OptiFine',
  description: '下载 OptiFine 安装包、提取内置 launchwrapper 并执行 optifine.Patcher 生成 patched jar',
  tags: ['loader', 'optifine', 'install'],
  depends: [
    LOADER_CAPABILITY.pathsGet,
    LOADER_CAPABILITY.downloadText,
    LOADER_CAPABILITY.downloadFile,
    LOADER_CAPABILITY.versionVerify,
    LOADER_CAPABILITY.versionInstall,
    LOADER_CAPABILITY.versionInstalled,
    LOADER_CAPABILITY.javaPick,
    LOADER_CAPABILITY.javaScan,
  ],
  http: {
    method: 'POST',
    path: '/api/loaders/optifine/install',
    decode: (request) => decodeInstallInput(request),
    background: { kind: 'loader-install', title: '安装 OptiFine' },
  },
  execute(input, env) {
    const { gameVersion, loaderVersion } = requireInstallInput(input)
    const host = createLoaderHost(env)
    return installOptiFine(host, { gameVersion, loaderVersion, label: 'OptiFine' })
  },
})
