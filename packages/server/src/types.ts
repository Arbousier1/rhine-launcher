/**
 * Server-local wire types.
 *
 * `ServerEvent` (see `@rhine/core`) has no bootstrap variant, so the socket
 * protocol adds one frame on top of it: the very first message a client
 * receives is always a `bootstrap` snapshot, every later message is a plain
 * `ServerEvent`.
 */
import type { Bootstrap, DiagnosticsApi, ServerEvent } from '@rhine/core'

/** Snapshot frame pushed right after the socket opens. */
export interface BootstrapFrame {
  type: 'bootstrap'
  bootstrap: Bootstrap
}

/** Reply to a client `{"type":"ping"}` keepalive probe. */
export interface PongFrame {
  type: 'pong'
  time: number
}

/** Anything the hub may send to a browser. */
export type WireMessage = BootstrapFrame | PongFrame | ServerEvent

/** Anything a browser may send back to the hub. */
export type ClientMessage =
  | { type: 'ping' }
  | { type: 'bootstrap' }
  | ServerEvent

/** Re-exported for convenience; core exposes diagnostics as an optional service. */
export type { DiagnosticsApi }
