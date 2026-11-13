import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, serversState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.servers.watch","InstanceServerInfoService","watch",[...COMMON,...["instance.list"]],serversState)
