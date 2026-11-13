import { serviceFeature } from '../../../ellan/feature.ts'
import { enableMods } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.enable", "InstanceModsService", "enable", ["paths.get","instance.list","mod.toggle","storage.read","events.emit"], enableMods)
