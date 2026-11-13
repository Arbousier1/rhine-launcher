import { serviceFeature } from '../../../ellan/feature.ts'
import { disableMods } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.disable", "InstanceModsService", "disable", ["paths.get","instance.list","mod.toggle","storage.read","events.emit"], disableMods)
