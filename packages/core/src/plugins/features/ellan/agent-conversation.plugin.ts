import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, agentConversation } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.agent.conversation","AgentService","getConversation",[...COMMON,...[]],agentConversation)
