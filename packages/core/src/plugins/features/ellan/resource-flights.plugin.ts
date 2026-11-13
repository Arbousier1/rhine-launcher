import { defineFeature } from '@rhine/plugin-api'
export default defineFeature<void, Response>({
 id: 'ellan.resource.flights', capability: 'ellan.resource.flights', title: 'flights',
 http: { method: 'GET', path: '/api/ellan-resource/flights', decode: () => undefined },
 execute: () => new Response('globalThis.flights = {};', { headers: { 'content-type': 'text/javascript; charset=utf-8' } }),
})
