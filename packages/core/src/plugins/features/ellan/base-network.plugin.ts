import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, networkStatus } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.base.network","BaseService","getNetworkStatus",[...COMMON,...["task.list"]],networkStatus)
