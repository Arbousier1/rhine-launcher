import { defineFeature } from '@rhine/plugin-api'
import { identifyModpack } from '../../../modpack/importer.ts'
export default defineFeature({
  id: 'modpack.identify', capability: 'modpack.identify', title: '识别整合包',
  depends: ['paths.get'],
  http: { method: 'POST', path: '/api/modpacks/identify', decode: request => request.json() },
  execute: identifyModpack,
})
