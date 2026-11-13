import { Settings, InstanceState, JavaState, UserState, XmclAccountState, ResourceState,
  InstanceInstallStatus, GameOptionsState, ServerInfoState, LocalCollectionState } from '../../../.reference/ellanlauncher/xmcl-runtime-api/index.ts'
export { Version } from '../../../.reference/ellanlauncher/packages/core/index.ts'
export { getResolvedVersionHeader, findMatchedVersion } from '../../../.reference/ellanlauncher/xmcl-runtime-api/src/entities/version.ts'
export const defaults = {
  Settings: new Settings(), InstanceState: new InstanceState(), JavaState: new JavaState(),
  UserState: new UserState(), XmclAccountState: new XmclAccountState(), ResourceState: new ResourceState(),
  InstanceInstallStatus: new InstanceInstallStatus(), GameOptionsState: new GameOptionsState(),
  ServerInfoState: new ServerInfoState(), LocalCollectionState: new LocalCollectionState(),
}
