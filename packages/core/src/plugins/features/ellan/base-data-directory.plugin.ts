import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, dataDirectory } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.base.directory","BaseService","getGameDataDirectory",[...COMMON,...[]],dataDirectory)
