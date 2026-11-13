import { transportFeature } from '../../../ellan/feature.ts'
import { releaseRenderer } from '../../../ellan/state.ts'
export default transportFeature('ellan.transport.release-renderer','release-renderer',[],(input,env)=>releaseRenderer(env,input.rendererId))
