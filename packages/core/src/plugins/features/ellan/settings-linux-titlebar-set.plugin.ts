import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.linux-titlebar-set','Settings',"linuxTitlebarSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("linuxTitlebarSet",input,env))
