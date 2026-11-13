import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, screenshots } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.screenshot.items","InstanceScreenshotService","getScreenshotItems",[...COMMON,...["instance.list"]],screenshots)
