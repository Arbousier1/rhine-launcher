import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, optionsState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.options.watch","InstanceOptionsService","watch",[...COMMON,...["instance.list"]],optionsState)
