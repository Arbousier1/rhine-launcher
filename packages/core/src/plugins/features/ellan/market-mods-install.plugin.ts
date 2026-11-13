import { serviceFeature } from '../../../ellan/feature.ts'
import { installFromMarket } from '../../../ellan/market.ts'

export default serviceFeature('ellan.market.mods.install', 'InstanceModsService', 'installFromMarket', ['ellan.market.mods.resolve', 'ellan.manifest.install'], (input, env) => installFromMarket(input, env, 'mods'), { kind: 'market-install', title: 'Install mods from market', waitForResult: true })
