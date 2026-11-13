import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, memoryStatus } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.base.memory","BaseService","getMemoryStatus",[...COMMON,...[]],memoryStatus)
