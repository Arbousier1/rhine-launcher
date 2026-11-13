import { serviceFeature } from '../../../ellan/feature.ts'
import { uninstallMods } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.uninstall", "InstanceModsService", "uninstall", ["paths.get","instance.list","mod.remove","storage.read","events.emit"], uninstallMods)
