import { serviceFeature } from '../../../ellan/feature.ts'
import { watchMods } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.watch", "InstanceModsService", "watch", ["paths.get","instance.list","storage.read","events.emit"], watchMods)
