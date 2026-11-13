import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.quick-action-shortcut-set','Settings',"quickActionShortcutSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("quickActionShortcutSet",input,env))
