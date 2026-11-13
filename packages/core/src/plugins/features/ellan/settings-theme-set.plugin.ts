import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.theme-set','Settings',"themeSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("themeSet",input,env))
