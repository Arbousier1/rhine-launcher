import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, saveLinked } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.saves.linked","InstanceSavesService","isSaveLinked",[...COMMON,...["instance.list"]],saveLinked)
