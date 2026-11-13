import { serviceFeature } from '../../../ellan/feature.ts'
import { kill } from '../../../ellan/launch.ts'
export default serviceFeature('ellan.launch.kill', 'LaunchService', 'kill', ['session.stop'], kill)
