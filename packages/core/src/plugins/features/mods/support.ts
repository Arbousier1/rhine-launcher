import { object } from '../../../modpack/safety.ts'
import { identifier } from '../../http-input.ts'

export function instanceId(input: unknown): string {
  const value = object(input)
  return identifier(value.id ?? value.instanceId, '实例 ID')
}
export async function modBody(request: Request, params: Record<string, string>, optional = false): Promise<Record<string, unknown>> {
  const raw = await request.text()
  const body = raw.trim() ? object(JSON.parse(raw)) : optional ? {} : object(undefined)
  if(body.enabled!==undefined&&typeof body.enabled!=='boolean')throw new Error('enabled必须是布尔值')
  return { ...body, id: identifier(params.id,'实例 ID'), diskName: params.diskName ?? body.diskName }
}
