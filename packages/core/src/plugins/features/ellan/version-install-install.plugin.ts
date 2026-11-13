import { serviceFeature } from '../../../ellan/feature.ts'
import { install } from '../../../ellan/launch.ts'
export default {
  ...serviceFeature('ellan.version-install.install', 'VersionInstallService', 'install', [
    'paths.get', 'storage.write', 'events.emit', 'instance.list', 'version.installed', 'version.get', 'version.resolve',
    'version.verify', 'version.install', 'minecraft.client.install', 'minecraft.libraries.install',
    'minecraft.assets.install', 'minecraft.logging.install', 'download.file',
  ], install, {kind:'installProfile',title:'安装与修复游戏',waitForResult:true}),
  optionalDepends: ['loader.fabric.install', 'loader.quilt.install', 'loader.forge.install', 'loader.neoforge.install', 'loader.optifine.install', 'java.install'],
}
