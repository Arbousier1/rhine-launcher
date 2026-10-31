/** Test/compatibility catalog only. Production discovers each *.plugin.ts independently. */
import list from '../plugins/features/accounts/list.plugin.ts'
import get from '../plugins/features/accounts/get.plugin.ts'
import remove from '../plugins/features/accounts/remove.plugin.ts'
import refresh from '../plugins/features/accounts/refresh.plugin.ts'
import authorize from '../plugins/features/accounts/authorize.plugin.ts'
import offline from '../plugins/features/auth/offline-login.plugin.ts'
import microsoftBegin from '../plugins/features/auth/microsoft-begin.plugin.ts'
import microsoftComplete from '../plugins/features/auth/microsoft-complete.plugin.ts'
import microsoftRefresh from '../plugins/features/auth/microsoft-refresh.plugin.ts'
import yggdrasilLogin from '../plugins/features/auth/yggdrasil-login.plugin.ts'
import yggdrasilRefresh from '../plugins/features/auth/yggdrasil-refresh.plugin.ts'
import yggdrasilValidate from '../plugins/features/auth/yggdrasil-validate.plugin.ts'
import agent from '../plugins/features/auth/agent-prepare.plugin.ts'

export const accountFeatures = [list, get, remove, refresh, authorize, offline, microsoftBegin, microsoftComplete, microsoftRefresh, yggdrasilLogin, yggdrasilRefresh, yggdrasilValidate, agent] as const
