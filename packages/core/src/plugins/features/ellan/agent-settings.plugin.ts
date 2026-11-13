import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, agentSettings } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.agent.settings","AgentService","getProviderSettings",[...COMMON,...[]],agentSettings)
