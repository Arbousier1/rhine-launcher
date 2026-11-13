import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, validatePath } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.instance.validate","InstanceService","validateInstancePath",[...COMMON,...["instance.list"]],validatePath)
