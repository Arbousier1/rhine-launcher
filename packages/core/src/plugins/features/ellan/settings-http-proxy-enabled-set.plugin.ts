import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.http-proxy-enabled-set','Settings',"httpProxyEnabledSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("httpProxyEnabledSet",input,env))
