import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, localVersions } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.version.state","VersionService","getLocalVersions",[...COMMON,...["version.installed"]],localVersions)
