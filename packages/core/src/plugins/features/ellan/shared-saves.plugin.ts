import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, sharedSaves } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.saves.shared","InstanceSavesService","getSharedSaves",[...COMMON,...[]],sharedSaves)
