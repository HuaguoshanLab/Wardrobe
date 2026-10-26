import { z } from 'zod'
import type { components } from '../../generated/api'
import { api } from '../../lib/http'

export const attributesSchema = z.object({
  category: z.string().nullable(),
  name: z.string().nullable(),
  color_codes: z.array(z.string()),
  seasons: z.array(z.string()),
  occasion_codes: z.array(z.string()),
  style_codes: z.array(z.string()),
  material: z.string().nullable(),
  thickness: z.string().nullable(),
  warmth: z.string().nullable(),
  custom_tag_ids: z.array(z.uuid()),
  availability: z.enum(['available', 'unavailable']),
  display_variant: z.enum(['original', 'cutout']),
})
const _attributesContract: z.ZodType<components['schemas']['Attributes']> = attributesSchema
void _attributesContract
export type Attributes = z.infer<typeof attributesSchema>
export const garmentSchema = attributesSchema.extend({
  id: z.uuid(),
  image_asset_id: z.uuid(),
  is_demo: z.boolean(),
  version: z.int(),
  created_at: z.string(),
  image_url: z.string(),
  has_cutout: z.boolean(),
})
const _garmentContract: z.ZodType<components['schemas']['GarmentView']> = garmentSchema
void _garmentContract
export type Garment = z.infer<typeof garmentSchema>
export const tagSchema = z.object({ id: z.uuid(), name: z.string(), version: z.int() })
export const getTags = () => api('/tags', z.array(tagSchema))
export const getTaxonomy = () =>
  api(
    '/taxonomies',
    z.object({ version: z.int(), fields: z.record(z.string(), z.record(z.string(), z.string())) }),
  )
export const getGarments = (params: URLSearchParams) =>
  api(
    `/garments?${params}`,
    z.object({ items: z.array(garmentSchema), next_cursor: z.uuid().nullable() }),
  )
export const getGarment = (id: string) => api(`/garments/${id}`, garmentSchema)
export async function deleteGarment(item: Garment) {
  const response = await fetch(`/api/v1/garments/${item.id}`, {
    method: 'DELETE',
    headers: { 'If-Match': String(item.version) },
  })
  if (!response.ok)
    throw new Error(response.status === 409 ? '衣服已更新，请刷新后重试' : '删除失败')
}
