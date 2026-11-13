import { transportFeature } from '../../../ellan/feature.ts'
import { revalidate } from '../../../ellan/transport.ts'
export default transportFeature("ellan.transport.revalidate","revalidate",["events.emit","ellan.base.settings","ellan.instance.state","ellan.user.state","ellan.java.state","ellan.version.state","ellan.mods.watch","ellan.resourcepacks.watch","ellan.shaders.watch","ellan.options.watch","ellan.saves.watch","ellan.servers.watch","ellan.install.watch","ellan.collection.state","ellan.account.state","ellan.mod-group.state"],revalidate)
