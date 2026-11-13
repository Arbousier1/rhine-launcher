import { transportFeature } from '../../../ellan/feature.ts'
import { tasks } from '../../../ellan/transport.ts'
export default transportFeature("ellan.task.poll","task-poll",["task.list"],tasks)
