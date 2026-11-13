import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { duplicateInstance } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.instance.duplicate','InstanceService',"duplicateInstance",[...COMMON,'storage.write',...["instance.list","instance.duplicate"]],duplicateInstance)
