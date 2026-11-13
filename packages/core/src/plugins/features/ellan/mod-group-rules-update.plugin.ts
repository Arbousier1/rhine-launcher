import { serviceFeature } from '../../../ellan/feature.ts'
import { updateSharedModGroupRules } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.mod-group.rules-update", "InstanceModsGroupService", "updateSharedGroupRules", ["paths.get","storage.read","storage.write"], updateSharedModGroupRules)
