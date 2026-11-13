import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, settingsState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.base.settings","BaseService","getSettings",[...COMMON,...["settings.get"]],settingsState)
