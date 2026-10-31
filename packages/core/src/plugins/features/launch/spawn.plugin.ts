import { defineFeature } from '@rhine/plugin-api'
import { spawnGame } from '../../../runtime/spawn-game.ts'
import type { PreparedFeatureLaunch } from '../../../runtime/feature-plan.ts'
export default defineFeature<PreparedFeatureLaunch,ReturnType<typeof spawnGame>>({
 id:'launch.spawn',capability:'launch.spawn',title:'启动游戏进程',depends:['paths.get','storage.read.sync','storage.write','events.emit','settings.resolve','instance.mark-launched','instance.add-playtime'],
 execute:spawnGame
})
