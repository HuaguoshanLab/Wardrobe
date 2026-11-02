import { z } from 'zod'
import type { components } from '../../../generated/api'
import { api } from '../../../lib/http'
import { garmentSchema } from '../api'

export const actionSchema = z.enum([
  'mark_washing',
  'wash_done',
  'tags_add',
  'tags_remove',
  'location_set',
  'location_clear',
])
export type CareAction = z.infer<typeof actionSchema>
export const actions: Record<CareAction, string> = {
  mark_washing: '标为待洗',
  wash_done: '洗好了，恢复可穿',
  tags_add: '添加标签',
  tags_remove: '移除标签',
  location_set: '修改收纳位置',
  location_clear: '清空收纳位置',
}
export const itemSchema = z.object({
  id: z.uuid(),
  garment_id: z.uuid(),
  expected_version: z.int().positive(),
  action: actionSchema,
  tag_ids: z.array(z.uuid()).max(30).default([]),
  location: z.string().max(120).nullable().default(null),
})
export const batchSchema = z.object({ items: z.array(itemSchema).min(1).max(20) })
export const resultSchema = z.object({
  items: z.array(
    z.object({
      id: z.uuid(),
      garment_id: z.uuid(),
      success: z.boolean(),
      changed: z.boolean(),
      code: z.string(),
      message: z.string(),
      garment: garmentSchema.nullable(),
    }),
  ),
})
const _input: z.ZodType<components['schemas']['CareBatch']> = batchSchema
const _output: z.ZodType<components['schemas']['CareResult']> = resultSchema
void _input
void _output
export type CareBatch = z.infer<typeof batchSchema>
export type CareResult = z.infer<typeof resultSchema>
export function getCare(params: URLSearchParams) {
  return api(
    `/wardrobe/care?${params}`,
    z.object({ items: z.array(garmentSchema), next_cursor: z.uuid().nullable() }),
  )
}
export const saveCare = (body: CareBatch, key: string) =>
  api('/wardrobe/care/actions', resultSchema, {
    method: 'POST',
    headers: { 'Idempotency-Key': key },
    body: JSON.stringify(body),
  })
