import {defineFeature} from '@rhine/plugin-api'
import {mountNativePanel,setupNativePanel,type NativePanelInput,type NativePanelHandle} from '../../native-panels'
import {renderPacks} from './render'
export default defineFeature<NativePanelInput,NativePanelHandle>({id:'panel.packs',capability:'panel.packs',title:'原生整合包导入',optionalDepends:['launcher.bootstrap','launcher.packs.identify','launcher.packs.import','launcher.tasks.get','launcher.task.cancel'],setup:env=>setupNativePanel(env,'panel.packs'),execute:(input,env)=>mountNativePanel(env,'panel.packs',input,renderPacks)})
