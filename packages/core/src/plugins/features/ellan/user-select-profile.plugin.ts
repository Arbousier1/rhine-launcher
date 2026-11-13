import { serviceFeature } from '../../../ellan/feature.ts'
import { PROFILE_SELECT_DEPENDS, selectUserProfile } from '../../../ellan/accounts.ts'
export default serviceFeature('ellan.user.select-profile', 'UserService', 'selectUserGameProfile', PROFILE_SELECT_DEPENDS, selectUserProfile)
