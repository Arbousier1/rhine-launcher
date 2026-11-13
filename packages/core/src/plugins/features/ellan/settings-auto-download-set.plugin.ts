import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.auto-download-set','Settings',"autoDownloadSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("autoDownloadSet",input,env))
