import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, installState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.install.watch","InstanceInstallService","watchInstanceInstall",[...COMMON,...["instance.list","task.list"]],installState)
