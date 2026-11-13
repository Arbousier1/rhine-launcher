import { serviceFeature } from '../../../ellan/feature.ts'
import { launch } from '../../../ellan/launch.ts'
export default serviceFeature('ellan.launch.launch', 'LaunchService', 'launch', ['instance.list', 'launch.start'], launch)
