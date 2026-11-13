import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, currentTheme } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.theme.current","ThemeService","getCurrentTheme",[...COMMON,...[]],currentTheme)
