import { serviceFeature } from '../../../ellan/feature.ts'
import { updateModGroups } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mod-group.update", "InstanceModsGroupService", "updateModsGroups", ["paths.get","instance.list","storage.write","events.emit"], updateModGroups)
