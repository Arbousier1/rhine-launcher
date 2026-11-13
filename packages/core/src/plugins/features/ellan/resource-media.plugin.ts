import { defineFeature } from '@rhine/plugin-api'
import { media } from '../../../ellan/resources.ts'
export default defineFeature<{ path: string | null; range: string | null }, Promise<Response>>({
 id: 'ellan.resource.media', capability: 'ellan.resource.media', title: 'media', depends: ['paths.get'],
 http: { method: 'GET', path: '/api/ellan-resource/media', decode: request => ({ path: new URL(request.url).searchParams.get('path'), range: request.headers.get('range') }) },
 execute: (input, env) => media(input.path, input.range, env),
})
