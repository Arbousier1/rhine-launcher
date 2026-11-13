import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.api-sets-preference-set','Settings',"apiSetsPreferenceSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("apiSetsPreferenceSet",input,env))
