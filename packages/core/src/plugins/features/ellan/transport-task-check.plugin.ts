import { transportFeature } from '../../../ellan/feature.ts'
import { taskCheck } from '../../../ellan/transport.ts'
export default transportFeature("ellan.task.check","task-check",["task.list"],taskCheck)
