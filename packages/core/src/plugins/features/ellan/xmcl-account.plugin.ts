import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, xmclAccount } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.account.state","XmclAccountService","getXmclAccountState",[...COMMON,...[]],xmclAccount)
