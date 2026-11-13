import { serviceFeature } from '../../../ellan/feature.ts'
import { COMMON, backupConfig } from '../../../ellan/reads.ts'
export default serviceFeature("ellan.backup.config","BackupService","getAutoBackupConfig",[...COMMON,...[]],backupConfig)
