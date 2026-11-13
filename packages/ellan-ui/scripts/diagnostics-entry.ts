import { MinecraftFolder, Version } from '../../../.reference/ellanlauncher/packages/core/index.ts'
import { diagnoseInstallation, diagnoseServerInstallation } from '../../../.reference/ellanlauncher/packages/installer/installer.ts'
import { diagnoseVersionAssets } from '../../../.reference/ellanlauncher/packages/installer/assets.ts'
import { resolveMinecraftJarInstallFile, resolveMinecraftServerProfileTask } from '../../../.reference/ellanlauncher/packages/installer/minecraft.ts'
export { createMinecraftProcessWatcher as watchOriginalMinecraftProcess,
  generateArguments as generateOriginalClientArguments,
  generateArgumentsServer as generateOriginalServerArguments } from '../../../.reference/ellanlauncher/packages/core/launch.ts'
export { findMatchedVersion as matchOriginalInstalledVersion } from '../../../.reference/ellanlauncher/xmcl-runtime-api/src/entities/version.ts'

export function parseOriginalServerVersion(directory: string, id: string) {
  return Version.parseServer(directory, id)
}

/** Use the maintained diagnoses; only adapt the asset index layout used by Rhine. */
export async function diagnoseOriginalInstallation(directory: string, id: string, side: 'client' | 'server') {
  if (side === 'server') {
    const server = await Version.parseServer(directory, id)
    const base = await Version.parse(directory, server.minecraftVersion)
    return diagnoseServerInstallation(server, MinecraftFolder.from(directory), base, { strict: true })
  }
  const version = await Version.parse(directory, id)
  const issue = await diagnoseInstallation(version, { strict: true }) ?? {}
  // Rhine's maintained minecraft.assets.install stores <assetIndex.id>.json,
  // while Ellan's coordinator prefers <sha1>.json. Inspect the file the
  // actual Rhine launch will consume, with its publisher checksum intact.
  delete issue.assetsIndex
  delete issue.assets
  const assetIssue = await diagnoseVersionAssets({ ...version, assets: version.assetIndex?.id ?? version.assets }, {
    strict: true, useHashForAssetsIndex: false,
  })
  Object.assign(issue, assetIssue)
  return Object.keys(issue).length ? issue : undefined
}

/** Resolve genuine vanilla server artifacts and the original server.json schema. */
export async function planOriginalVanillaServer(directory: string, id: string) {
  const version = await Version.parse(directory, id)
  const file = resolveMinecraftJarInstallFile(version, { side: 'server' })
  if (!file?.checksum) throw new Error('Version has no verifiable server download: ' + id)
  const profile = resolveMinecraftServerProfileTask(version)
  return { file, operations: profile.operations }
}
