import { serviceFeature } from '../../../ellan/feature.ts'
import { AUTHORITY_WRITE_DEPENDS, removeAuthority } from '../../../ellan/accounts.ts'
export default serviceFeature('ellan.authority.remove', 'UserService', 'removeYggdrasilService', AUTHORITY_WRITE_DEPENDS, removeAuthority)
