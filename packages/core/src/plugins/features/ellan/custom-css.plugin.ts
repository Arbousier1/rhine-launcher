import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, customCss } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.theme.css","ThemeService","getCustomCss",[...COMMON,...[]],customCss)
