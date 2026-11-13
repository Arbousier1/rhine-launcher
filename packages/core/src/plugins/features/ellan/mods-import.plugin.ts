import { serviceFeature } from '../../../ellan/feature.ts'
import { importMods } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.import", "InstanceModsService", "import", ["paths.get","instance.list","mod.import","storage.read","events.emit"], importMods)
