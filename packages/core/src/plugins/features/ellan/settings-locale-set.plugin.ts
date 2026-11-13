import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.locale-set','Settings',"localeSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("localeSet",input,env))
