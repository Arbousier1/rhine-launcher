import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.max-a-p-i-sockets-set','Settings',"maxAPISocketsSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("maxAPISocketsSet",input,env))
