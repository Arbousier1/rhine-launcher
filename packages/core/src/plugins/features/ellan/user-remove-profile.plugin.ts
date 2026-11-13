import { serviceFeature } from '../../../ellan/feature.ts'
import { PROFILE_REMOVE_DEPENDS, removeUserProfile } from '../../../ellan/accounts.ts'
export default serviceFeature('ellan.user.remove-profile', 'UserService', 'removeUserGameProfile', PROFILE_REMOVE_DEPENDS, removeUserProfile)
