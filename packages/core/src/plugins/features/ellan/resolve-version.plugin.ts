import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, resolveVersion } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.version.resolve","VersionService","resolveLocalVersion",[...COMMON,...["version.installed"]],resolveVersion)
