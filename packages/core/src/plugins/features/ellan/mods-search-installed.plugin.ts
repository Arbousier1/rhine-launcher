import { serviceFeature } from '../../../ellan/feature.ts'
import { searchInstalledMods } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.search-installed", "InstanceModsService", "searchInstalled", ["paths.get","instance.list","storage.read"], searchInstalledMods)
