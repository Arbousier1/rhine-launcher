import { serviceFeature } from '../../../ellan/feature.ts'
import { diagnose } from '../../../ellan/launch.ts'
export default serviceFeature('ellan.version-install.diagnose', 'VersionInstallService', 'diagnose', ['paths.get'], diagnose)
