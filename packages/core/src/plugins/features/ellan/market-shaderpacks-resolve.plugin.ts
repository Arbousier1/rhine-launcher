import { serviceFeature } from '../../../ellan/feature.ts'
import { resolveFromMarket } from '../../../ellan/market.ts'

export default serviceFeature('ellan.market.shaderpacks.resolve', 'InstanceShaderPacksService', 'resolveFromMarket', ['paths.get', 'instance.list', 'settings.resolve'], (input, env) => resolveFromMarket(input, env, 'shaderpacks'))
