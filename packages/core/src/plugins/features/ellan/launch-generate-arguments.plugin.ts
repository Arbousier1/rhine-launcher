import { serviceFeature } from '../../../ellan/feature.ts'
import { generateArguments } from '../../../ellan/launch.ts'
export default serviceFeature('ellan.launch.arguments', 'LaunchService', 'generateArguments', ['instance.list', 'instance.get', 'paths.get', 'version.installed', 'version.resolve', 'account.get'], generateArguments)
