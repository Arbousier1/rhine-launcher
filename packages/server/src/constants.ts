/**
 * Wire constants shared by the HTTP app and the WebSocket hub.
 */

/** Path of the WebSocket endpoint. */
export const WS_PATH = '/ws'

/** Server initiated keepalive interval (30s, per the architecture document). */
export const HEARTBEAT_MS = 30_000

/** Largest accepted client frame. */
export const MAX_PAYLOAD_BYTES = 1 << 20
export const APP_NAME='Rhine Launcher'
export const APP_VERSION='0.2.0'
