import { serviceFeature } from '../../../ellan/feature.ts'
import { gameProcesses } from '../../../ellan/launch.ts'
export default serviceFeature('ellan.launch.processes', 'LaunchService', 'getGameProcesses', ['session.list'], gameProcesses)
