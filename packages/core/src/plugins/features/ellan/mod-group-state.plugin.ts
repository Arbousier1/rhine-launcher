import { serviceFeature } from '../../../ellan/feature.ts'
import { getModGroupState } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mod-group.state", "InstanceModsGroupService", "getGroupState", ["paths.get","instance.list","storage.read","events.emit"], getModGroupState)
