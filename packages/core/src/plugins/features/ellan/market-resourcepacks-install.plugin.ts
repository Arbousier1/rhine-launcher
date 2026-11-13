import { serviceFeature } from '../../../ellan/feature.ts'
import { installFromMarket } from '../../../ellan/market.ts'

export default serviceFeature('ellan.market.resourcepacks.install', 'InstanceResourcePacksService', 'installFromMarket', ['ellan.market.resourcepacks.resolve', 'ellan.manifest.install'], (input, env) => installFromMarket(input, env, 'resourcepacks'), { kind: 'market-install', title: 'Install resourcepacks from market', waitForResult: true })
