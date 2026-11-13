import { serviceFeature } from '../../../ellan/feature.ts'
import { resolveFromMarket } from '../../../ellan/market.ts'

export default serviceFeature('ellan.market.mods.resolve', 'InstanceModsService', 'resolveFromMarket', ['paths.get', 'instance.list', 'settings.resolve'], (input, env) => resolveFromMarket(input, env, 'mods'))
