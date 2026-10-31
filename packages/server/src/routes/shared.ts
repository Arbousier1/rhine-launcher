/**
 * Small helpers shared by the route modules.
 */
import type { Context } from 'hono'
import type { RhContext } from '@rhine/core'

/** Envelope returned by every "start a background task" endpoint. */
export interface TaskAccepted {
  /** Id usable with `GET /api/tasks` and `POST /api/tasks/:id/cancel`. */
  taskId: string
  /** Always present so the UI can render a label before the first event. */
  title: string
}

/** Envelope returned by destructive endpoints. */
export interface OkResponse {
  ok: true
  id?: string
}

/** Build the 202 payload for an asynchronously started task. */
export function accepted(c: Context, taskId: string, title: string): Response {
  const body: TaskAccepted = { taskId, title }
  return c.json(body, 202)
}

/** Build the canonical `{ ok: true }` payload. */
export function ok(c: Context, id?: string): Response {
  const body: OkResponse = id === undefined ? { ok: true } : { ok: true, id }
  return c.json(body)
}

/** Narrow the closure type so route modules never import `RhContext` twice. */
export type Ctx = RhContext
