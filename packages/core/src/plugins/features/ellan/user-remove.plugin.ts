import { serviceFeature } from '../../../ellan/feature.ts'
import { USER_REMOVE_DEPENDS, removeUser } from '../../../ellan/accounts.ts'
export default serviceFeature('ellan.user.remove', 'UserService', 'removeUser', USER_REMOVE_DEPENDS, removeUser)
