import {serviceFeature} from '../../../ellan/feature.ts'
import {refreshJava} from '../../../ellan/java.ts'
export default serviceFeature('ellan.java.refresh','JavaService','refreshLocalJava',['java.scan','events.emit'],refreshJava)
