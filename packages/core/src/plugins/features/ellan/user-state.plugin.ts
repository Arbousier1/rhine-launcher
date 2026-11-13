import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, userState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.user.state","UserService","getUserState",[...COMMON,...["account.list"]],userState)
