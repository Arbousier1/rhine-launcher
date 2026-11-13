import { FeatureError } from '@rhine/plugin-api'
import { record, serviceFeature } from '../../../ellan/feature.ts'
export default serviceFeature('ellan.version-install.instance', 'VersionInstallService', 'installInstance', ['ellan.version-install.install'], async (input, env) => {
  if (record(input.args[0]).type !== 'instance') throw new FeatureError('INVALID_ORIGINAL_CALL', 'installInstance only accepts an instance request', 400)
  const result = await env.use<Promise<{ result: unknown }>>('ellan.version-install.install', input)
  return result.result
}, {kind:'installInstance',title:'安装实例',waitForResult:true})
