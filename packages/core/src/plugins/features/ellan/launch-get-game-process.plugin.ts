import { serviceFeature } from '../../../ellan/feature.ts'
import { gameProcess } from '../../../ellan/launch.ts'
export default serviceFeature('ellan.launch.process', 'LaunchService', 'getGameProcess', ['session.get'], gameProcess)
