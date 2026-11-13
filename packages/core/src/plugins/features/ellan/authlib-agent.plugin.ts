import { serviceFeature } from '../../../ellan/feature.ts'
import { prepareAuthlibAgent } from '../../../ellan/launch.ts'
export default serviceFeature('ellan.authlib.prepare', 'AuthlibInjectorService', 'getOrInstallAuthlibInjector', ['auth.agent.prepare'], prepareAuthlibAgent)
