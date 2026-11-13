import { serviceFeature } from '../../../ellan/feature.ts'
import { lookupProjectByModrinth } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.project-mapping.modrinth", "ProjectMappingService", "lookupByModrinth", ["paths.get","storage.read"], lookupProjectByModrinth)
