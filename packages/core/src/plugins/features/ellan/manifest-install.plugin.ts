import { serviceFeature } from '../../../ellan/feature.ts'
import { installInstanceFiles } from '../../../ellan/manifests.ts'

export default serviceFeature('ellan.manifest.install', 'InstanceInstallService', 'installInstanceFiles', ['paths.get', 'instance.list', 'settings.resolve', 'download.file', 'storage.read', 'storage.write', 'events.emit'], installInstanceFiles, { kind: 'instance-install', title: 'Install instance files', waitForResult: true })
