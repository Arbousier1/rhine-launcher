import { serviceFeature } from '../../../ellan/feature.ts'
import { installMods } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.install", "InstanceModsService", "install", ["paths.get","instance.list","mod.import","storage.read","events.emit"], installMods)
