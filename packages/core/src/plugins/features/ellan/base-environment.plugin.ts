import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, environment } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.base.environment","BaseService","getEnvironment",[...COMMON,...["bootstrap"]],environment)
