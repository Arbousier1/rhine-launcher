import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { editInstance } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.instance.edit','InstanceService',"editInstance",[...COMMON,'storage.write',...["instance.list","instance.update"]],editInstance)
