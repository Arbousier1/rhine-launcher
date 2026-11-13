import { serviceFeature } from '../../../ellan/feature.ts'
import { lookupProjectByCurseforge } from '../../../ellan/mod-operations.ts'

export default serviceFeature("ellan.project-mapping.curseforge", "ProjectMappingService", "lookupByCurseforge", ["paths.get","storage.read"], lookupProjectByCurseforge)
