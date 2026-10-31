import { defineFeature } from '@rhine/plugin-api'
import { selectedVersion } from '../../../runtime/feature-plan.ts'
export default defineFeature<any,Promise<string>>({id:'version.select',capability:'version.select',title:'解析实例版本',depends:['version.installed','version.get'],execute:({instance},env)=>selectedVersion(instance,env)})
