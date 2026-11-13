import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { deleteInstance } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.instance.remove','InstanceService',"deleteInstance",[...COMMON,'storage.write',...["instance.list","instance.remove"]],deleteInstance)
