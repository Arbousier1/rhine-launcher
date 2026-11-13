import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, resourcesState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.shaders.watch","InstanceShaderPacksService","watch",[...COMMON,"instance.list"],(input,env)=>resourcesState(input,env,"shaderpacks","ellan.shaders.watch"))
