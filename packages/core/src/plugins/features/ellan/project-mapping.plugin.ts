import { serviceFeature } from '../../../ellan/feature.ts'
import { lookupProjectMappings } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.project-mapping.batch", "ProjectMappingService", "lookupBatch", ["paths.get","storage.read"], lookupProjectMappings)
