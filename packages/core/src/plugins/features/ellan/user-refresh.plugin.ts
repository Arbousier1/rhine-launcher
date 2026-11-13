import { serviceFeature } from '../../../ellan/feature.ts'
import { refreshUser } from '../../../ellan/launch.ts'
export default serviceFeature('ellan.user.refresh', 'UserService', 'refreshUser', ['account.refresh', 'events.emit'], refreshUser)
