import { serviceFeature } from '../../../ellan/feature.ts'
import { AUTHORITY_ADD_DEPENDS, addAuthority } from '../../../ellan/accounts.ts'
export default serviceFeature('ellan.authority.add', 'UserService', 'addYggdrasilService', AUTHORITY_ADD_DEPENDS, addAuthority)
