import type {Bootstrap,RhContext} from '@rhine/core'
/** HTTP and WS obtain the same independently managed snapshot capability. */
export function buildBootstrap(ctx:RhContext):Promise<Bootstrap>{return ctx.features.call<Promise<Bootstrap>>('bootstrap')}
