import { serviceFeature } from '../../../ellan/feature.ts'
import { lookupProjectByKeyword } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.project-mapping.keyword", "ProjectMappingService", "lookupByKeyword", ["paths.get","storage.read"], lookupProjectByKeyword)
