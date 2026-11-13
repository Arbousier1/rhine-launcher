import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, javaState } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.java.state","JavaService","getJavaState",[...COMMON,...["java.scan"]],javaState)
