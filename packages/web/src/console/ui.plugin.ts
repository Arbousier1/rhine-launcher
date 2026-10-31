import {defineFeature} from '@rhine/plugin-api'
/** One native interface. Each gameplay operation remains an independently scoped plugin. */
export default defineFeature<void,Promise<void>>({
 id:'console.ui.mount',capability:'console.ui.mount',title:'原生莱茵游戏档案界面',
 optionalDepends:['renderer.webgl.create','renderer.webgpu.create','panel.accounts','panel.mods','panel.packs','launcher.bootstrap','launcher.events.connect','launcher.launch.start','launcher.session.stop','launcher.instance.create','launcher.instance.update','launcher.account.offline','launcher.mods.list','launcher.system.reveal','launcher.versions.list','launcher.version.details','launcher.loader.versions','launcher.version.install','launcher.loader.install','launcher.task.wait','launcher.task.cancel','launcher.versions.installed'],
 setup(env){const life=env.state('console.ui.lifecycle',()=>({mounted:false}));env.onDispose(()=>{life.mounted=false})},
 async execute(_input,env){const life=env.state('console.ui.lifecycle',()=>({mounted:false}));if(life.mounted)return;const {mountConsole}=await import('./main');env.signal.throwIfAborted();if(life.mounted)return;life.mounted=true;try{mountConsole(env)}catch(error){life.mounted=false;throw error}}
})
