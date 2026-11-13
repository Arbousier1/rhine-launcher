import { serviceFeature } from '../../../ellan/feature.ts'
import { AUTHORITY_READ_DEPENDS, supportedAuthorities } from '../../../ellan/accounts.ts'
export default serviceFeature('ellan.user.authorities', 'UserService', 'getSupportedAuthorityMetadata', AUTHORITY_READ_DEPENDS, supportedAuthorities)
