import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, bedrockSupported } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.bedrock.supported","BedrockService","isSupported",[...COMMON,...[]],bedrockSupported)
