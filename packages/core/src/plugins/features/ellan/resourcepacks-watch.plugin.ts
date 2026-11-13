import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, resourcesState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.resourcepacks.watch","InstanceResourcePacksService","watch",[...COMMON,"instance.list"],(input,env)=>resourcesState(input,env,"resourcepacks","ellan.resourcepacks.watch"))
