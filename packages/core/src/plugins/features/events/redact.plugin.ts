import {defineFeature} from '@rhine/plugin-api'
import {publicValue} from '../../public-value.ts'
export default defineFeature<unknown,unknown>({id:'events.redact',capability:'events.redact',title:'过滤公开事件中的凭据',execute:publicValue})
