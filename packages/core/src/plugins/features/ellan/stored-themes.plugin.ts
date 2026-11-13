import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, storedThemes } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.theme.stored","ThemeService","getStoredThemes",[...COMMON,...[]],storedThemes)
