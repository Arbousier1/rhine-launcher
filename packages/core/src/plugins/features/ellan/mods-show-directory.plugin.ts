import { serviceFeature } from '../../../ellan/feature.ts'
import { showModsDirectory } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.show-directory", "InstanceModsService", "showDirectory", ["paths.get","instance.list","system.reveal"], showModsDirectory)
