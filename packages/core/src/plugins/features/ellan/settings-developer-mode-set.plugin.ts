import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.developer-mode-set','Settings',"developerModeSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("developerModeSet",input,env))
