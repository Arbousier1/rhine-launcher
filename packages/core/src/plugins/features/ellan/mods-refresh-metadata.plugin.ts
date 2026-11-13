import { serviceFeature } from '../../../ellan/feature.ts'
import { refreshModsMetadata } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mods.refresh-metadata", "InstanceModsService", "refreshMetadata", ["paths.get","instance.list","storage.read","events.emit"], refreshModsMetadata)
