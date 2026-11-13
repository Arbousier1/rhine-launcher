import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, localCollections } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.collection.state","CollectionService","getLocalCollections",[...COMMON,...[]],localCollections)
