import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, instanceTheme } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.instance.theme","InstanceThemeService","getInstanceTheme",[...COMMON,...["instance.list"]],instanceTheme)
