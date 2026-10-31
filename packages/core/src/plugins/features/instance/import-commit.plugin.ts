import {defineFeature} from '@rhine/plugin-api'
import {implementation} from '../../implementation.ts'
import {object,string} from '../../http-input.ts'
import {InstanceService,normalizeConfig} from '../../../services/instances.ts'
export default defineFeature<any,any>({
 id:'instance.import.commit',capability:'instance.import.commit',title:'原子提交已验证实例',depends:['paths.get','storage.write','events.emit'],
 execute(input,env){const config=normalizeConfig({...object(input.config),name:string(input.config.name),gameVersion:string(input.config.gameVersion)});return implementation(env,'engine.instances',ctx=>new InstanceService(ctx)).commitImport(string(input.stagingPath),config,env.signal)}
})
