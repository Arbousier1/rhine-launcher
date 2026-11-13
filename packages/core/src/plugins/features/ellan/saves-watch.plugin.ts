import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, savesState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.saves.watch","InstanceSavesService","watch",[...COMMON,...["instance.list"]],savesState)
