import { serviceFeature } from '../../../ellan/feature.ts'
import { getSharedModGroupRules } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mod-group.rules", "InstanceModsGroupService", "getSharedGroupRules", ["paths.get","storage.read"], getSharedModGroupRules)
