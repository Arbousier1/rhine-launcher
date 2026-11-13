import { serviceFeature } from '../../../ellan/feature.ts'
import { LOGIN_DEPENDS, loginUser } from '../../../ellan/accounts.ts'
export default serviceFeature('ellan.user.login', 'UserService', 'login', LOGIN_DEPENDS, loginUser)
