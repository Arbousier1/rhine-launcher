import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, autoBackups } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.backup.list","BackupService","listAutoBackups",[...COMMON,...[]],autoBackups)
