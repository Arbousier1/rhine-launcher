import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON } from '../../../ellan/reads.ts'
import { settingMutation } from '../../../ellan/mutations.ts'
export default serviceFeature('ellan.settings.discord-presence-set','Settings',"discordPresenceSet",[...COMMON,'storage.write','settings.get','settings.update'],(input,env)=>settingMutation("discordPresenceSet",input,env))
