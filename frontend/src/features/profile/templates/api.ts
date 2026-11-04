import { z } from 'zod'
import { api, ApiError } from '../../../lib/http'
import { operationId } from '../../../lib/id'
import { requirementsSchema, type Requirements } from '../api'
import type { components } from '../../../generated/api'
export const fieldsSchema = requirementsSchema
  .pick({
    occasion_codes: true,
    style_codes: true,
    custom_tag_ids: true,
    notes: true,
    rotation_mode: true,
  })
  .strict()
export type Fields = z.infer<typeof fieldsSchema>
const contract: z.ZodType<components['schemas']['TemplateConditions']> = fieldsSchema
void contract
export const templateSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  conditions: z.record(z.string(), z.json()),
  version: z.int(),
  created_at: z.string(),
  updated_at: z.string(),
  issues: z.array(z.string()),
})
export type Template = z.infer<typeof templateSchema>
export const listTemplates = () => api('/condition-templates', z.array(templateSchema))
export const getTemplate = (id: string) => api(`/condition-templates/${id}`, templateSchema)
export const pickFields = (r: Requirements): Fields => ({
  occasion_codes: r.occasion_codes,
  style_codes: r.style_codes,
  custom_tag_ids: r.custom_tag_ids,
  notes: r.notes || null,
  rotation_mode: r.rotation_mode,
})
export const operationSchema = z.object({
  method: z.enum(['POST', 'PATCH', 'DELETE']),
  id: z.uuid().nullable(),
  body: z.string(),
  key: z.string(),
})
export type Operation = z.infer<typeof operationSchema>
const pendingKey = 'wardrobe.template.operation'
export function pendingOperation(): Operation | null {
  try {
    return operationSchema.parse(JSON.parse(localStorage.getItem(pendingKey) ?? 'null'))
  } catch {
    return null
  }
}
export function forgetOperation() {
  localStorage.removeItem(pendingKey)
}
export async function sendOperation(operation: Operation) {
  localStorage.setItem(pendingKey, JSON.stringify(operation))
  try {
    const path = `/condition-templates${operation.id ? `/${operation.id}` : ''}`
    if (operation.method === 'DELETE')
      await api(path, z.object({ id: z.uuid(), version: z.int(), deleted: z.literal(true) }), {
        method: operation.method,
        body: operation.body,
        headers: { 'Idempotency-Key': operation.key },
      })
    else
      await api(path, templateSchema, {
        method: operation.method,
        body: operation.body,
        headers: { 'Idempotency-Key': operation.key },
      })
    forgetOperation()
  } catch (e) {
    // A definite validation/version response did not commit; transport/5xx stays replayable.
    if (e instanceof ApiError && e.status >= 400 && e.status < 500) forgetOperation()
    throw e
  }
}
export function operation(method: Operation['method'], id: string | null, body: object): Operation {
  return { method, id, body: JSON.stringify(body), key: operationId() }
}
