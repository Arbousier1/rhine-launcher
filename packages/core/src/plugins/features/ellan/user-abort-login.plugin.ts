import { serviceFeature } from '../../../ellan/feature.ts'
import { ABORT_LOGIN_DEPENDS, abortLogin } from '../../../ellan/accounts.ts'
export default serviceFeature('ellan.user.abort-login', 'UserService', 'abortLogin', ABORT_LOGIN_DEPENDS, abortLogin)
