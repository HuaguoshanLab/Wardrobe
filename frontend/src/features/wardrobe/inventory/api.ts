import { entityId } from '../../../lib/id'
import { z } from 'zod'
import type { components } from '../../../generated/api'
import { api } from '../../../lib/http'
import { subtypeSchema } from '../lifecycle-api'

export const seasons = { spring: '春', summer: '夏', autumn: '秋', winter: '冬' } as const
export const seasonSchema = z.enum(['spring', 'summer', 'autumn', 'winter'])
export type Season = z.infer<typeof seasonSchema>
export const rotationSchema = z.object({
  weekly_days: z.int().min(0).max(7),
  laundry_days: z.int().min(1).max(60),
  drying_days: z.int().min(0).max(30),
  repeat_wears: z.int().min(1).max(100),
  spare: z.int().min(0).max(100),
})
export const demandSchema = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1, '填写需求名称').max(80),
    category: z.string().min(1),
    subtype_ids: z.array(z.uuid()),
    occasion_codes: z.array(z.string()),
    tag_ids: z.array(z.uuid()),
    lower: z.int().min(0).max(10000).nullable(),
    upper: z.int().min(0).max(10000).nullable(),
    notes: z.string().max(1000),
    enabled: z.boolean(),
    estimate: rotationSchema.nullable(),
  })
  .superRefine((r, ctx) => {
    if (
      (r.lower === null) !== (r.upper === null) ||
      (r.lower !== null && r.upper !== null && r.lower > r.upper)
    )
      ctx.addIssue({
        code: 'custom',
        path: ['upper'],
        message: '同时填写上下限，且下限不能大于上限；也可同时留空。',
      })
  })
export const planFieldsSchema = z.object({
  city: z.string(),
  period: z.string(),
  notes: z.string(),
  rows: z.array(demandSchema).max(100),
})
export const planSchema = planFieldsSchema.extend({ season: seasonSchema, version: z.int() })
export const planInputSchema = planFieldsSchema.extend({ expected_version: z.int() })
const memberSchema = z.object({
  garment_id: z.uuid(),
  bucket: z.enum(['confirmed', 'pending', 'excluded']),
  reasons: z.array(z.string()),
  covered_by: z.array(z.object({ id: z.uuid(), season: seasonSchema, name: z.string() })),
})
const countSchema = z.object({
  row_id: z.uuid(),
  planned: z.int().default(0),
  matched_owned: z.int(),
  confirmed: z.int(),
  pending: z.int(),
  unavailable: z.int(),
  available: z.int(),
  needs_attention: z.int(),
  shared: z.int(),
  conclusion: z.enum(['unset', 'review', 'shortage', 'enough', 'excess', 'invalid', 'disabled']),
  difference: z.int().nullable(),
  rule_errors: z.array(z.string()),
  members: z.array(memberSchema),
})
export const inventorySchema = z.object({
  plan: planSchema,
  stats_at: z.string(),
  config_versions: z.record(z.string(), z.int()),
  total_owned: z.int(),
  counts: z.array(countSchema),
  garments: z.array(
    z.object({ id: z.uuid(), name: z.string(), image_url: z.string(), version: z.int() }),
  ),
})
const _contract: z.ZodType<components['schemas']['InventoryView']> = inventorySchema
void _contract
export type Demand = z.infer<typeof demandSchema>
export type Plan = z.infer<typeof planSchema>
export type Inventory = z.infer<typeof inventorySchema>
export type Count = z.infer<typeof countSchema>
export type Rotation = z.infer<typeof rotationSchema>
export const getInventory = (season: Season) => api(`/inventory/${season}`, inventorySchema)
export const getConfigs = () => api('/inventory/configs', z.array(planSchema))
export const estimateTarget = (category: string, occasion_codes: string[], values: Rotation) =>
  api('/inventory/estimate', z.object({ lower: z.int(), explanation: z.string() }), {
    method: 'POST',
    body: JSON.stringify({ category, occasion_codes, ...values }),
  })
export const getSuggestions = () =>
  api('/garment-subtypes/suggestions', z.record(z.string(), z.array(z.string())))
export const impactSchema = z.object({
  subtype: subtypeSchema,
  garment_count: z.int(),
  owned_count: z.int(),
  token: z.string(),
  rows: z.array(
    z.object({ id: z.uuid(), season: z.string(), name: z.string(), enabled: z.boolean() }),
  ),
})
export const getImpact = (id: string) => api(`/garment-subtypes/${id}/impact`, impactSchema)
export const newDemand = (): Demand => ({
  id: entityId(),
  name: '',
  category: 'top',
  subtype_ids: [],
  occasion_codes: [],
  tag_ids: [],
  lower: null,
  upper: null,
  notes: '',
  enabled: true,
  estimate: null,
})
export const targetLabel = (row: Demand) =>
  row.lower === null ? '未设目标' : `${row.lower}–${row.upper} 件`
export function conclusionLabel(count: Count) {
  return {
    unset: '未设目标',
    review: '先核对，再决定',
    shortage: `按已录衣橱至少缺 ${count.difference} 件`,
    enough: '已确认数量达标',
    excess: `超过自定目标 ${count.difference} 件`,
    invalid: '规则待修复',
    disabled: '此需求已停用',
  }[count.conclusion]
}
