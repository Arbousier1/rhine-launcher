import { serviceFeature } from '../../../ellan/feature.ts'
import { installFromMarket } from '../../../ellan/market.ts'

export default serviceFeature('ellan.market.shaderpacks.install', 'InstanceShaderPacksService', 'installFromMarket', ['ellan.market.shaderpacks.resolve', 'ellan.manifest.install'], (input, env) => installFromMarket(input, env, 'shaderpacks'), { kind: 'market-install', title: 'Install shaderpacks from market', waitForResult: true })
