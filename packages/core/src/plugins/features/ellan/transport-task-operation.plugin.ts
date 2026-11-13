import { transportFeature } from '../../../ellan/feature.ts'
import { taskOperation } from '../../../ellan/transport.ts'
export default transportFeature("ellan.task.operation","task-operation",["task.cancel"],taskOperation)
