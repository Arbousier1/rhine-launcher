import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, instancesState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.instance.state","InstanceService","getSharedInstancesState",[...COMMON,...["instance.list"]],instancesState)
