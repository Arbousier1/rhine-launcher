import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { createInstance } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.instance.create','InstanceService',"createInstance",[...COMMON,'storage.write',...["instance.list","instance.update","instance.create","instance.remove"]],createInstance)
