import { defineFeature } from '@rhine/plugin-api'
import { prepareFeatureLaunch } from '../../../runtime/feature-plan.ts'
export default defineFeature<any,ReturnType<typeof prepareFeatureLaunch>>({
 id:'launch.prepare',capability:'launch.prepare',title:'准备启动计划',
 depends:['instance.get','version.verify','version.install','version.select','version.resolve','paths.get','account.authorize','java.pick','java.scan','java.install','settings.resolve','minecraft.libraries.install','minecraft.assets.install','minecraft.logging.install','minecraft.natives.extract'],
 optionalDepends:['auth.agent.prepare','loader.fabric.install','loader.quilt.install','loader.forge.install','loader.neoforge.install','loader.optifine.install'],
 execute:(input,env)=>prepareFeatureLaunch(input,env,false)
})
