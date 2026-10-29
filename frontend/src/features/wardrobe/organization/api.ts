import { z } from 'zod'
import type { components } from '../../../generated/api'
import { api } from '../../../lib/http'

export const sourceSchema = z.object({
  id: z.uuid(),
  season: z.string(),
  name: z.string(),
  active: z.boolean(),
})
export const supplySchema = z.object({
  id: z.uuid(),
  version: z.int(),
  name: z.string(),
  quantity: z.int(),
  budget: z.string().nullable(),
  reason: z.string(),
  notes: z.string(),
  status: z.enum(['planned', 'purchased', 'completed', 'cancelled']),
  cancelled_quantity: z.int(),
  remaining: z.int(),
  sources: z.array(sourceSchema),
  linked: z.array(z.object({ id: z.uuid(), name: z.string(), archived: z.boolean() })),
})
export const supplyInputSchema = z.object({
  expected_version: z.int().min(0),
  name: z.string().trim().min(1).max(80),
  quantity: z.int().min(1).max(10000),
  budget: z
    .string()
    .regex(/^\d+(\.\d{1,2})?$/)
    .nullable(),
  reason: z.string().max(500),
  notes: z.string().max(2000),
  status: z.enum(['planned', 'purchased']),
  source_ids: z.array(z.uuid()),
})
export const candidateSchema = z.object({
  garment_id: z.uuid(),
  garment_version: z.int(),
  name: z.string(),
  image_url: z.string(),
  reason_key: z.string(),
  reason: z.string(),
  decision_version: z.int(),
  state: z.enum(['suggested', 'observe', 'pending', 'keep', 'repair', 'done', 'undecided']),
  note: z.string(),
  current: z.boolean(),
  archived: z.boolean(),
})
export const boardSchema = z.object({
  shortages: z.array(
    z.object({
      source: sourceSchema,
      difference: z.int(),
      planned: z.int(),
      needs_attention: z.int(),
    }),
  ),
  candidates: z.array(candidateSchema),
  next_cursor: z.string().nullable(),
  stats_at: z.string(),
})
export const exitSchema = z.object({
  garment_id: z.uuid(),
  garment_version: z.int(),
  token: z.string(),
  invalid_sources: z.array(sourceSchema),
  rows: z.array(
    z.object({
      source: sourceSchema,
      lower: z.int().nullable(),
      upper: z.int().nullable(),
      before_confirmed: z.int(),
      after_confirmed: z.int(),
      before_pending: z.int(),
      after_pending: z.int(),
      conclusion: z.string(),
      difference: z.int().nullable(),
    }),
  ),
})
const _supply: z.ZodType<components['schemas']['SupplyView']> = supplySchema
const _board: z.ZodType<components['schemas']['OrganizationView']> = boardSchema
const _exit: z.ZodType<components['schemas']['ExitImpact']> = exitSchema
void [_supply, _board, _exit]
export type Supply = z.infer<typeof supplySchema>
export type SupplyInput = z.infer<typeof supplyInputSchema>
export type Candidate = z.infer<typeof candidateSchema>
export type ExitImpact = z.infer<typeof exitSchema>
export const getSupply = (id: string) => api(`/supply-plans/${id}`, supplySchema)
export const getSupplies = (cursor = '') =>
  api(
    `/supply-plans${cursor ? '?' + new URLSearchParams({ cursor }) : ''}`,
    z.object({ items: z.array(supplySchema), next_cursor: z.uuid().nullable() }),
  )
export const getBoard = (state = 'active', cursor = '') =>
  api(`/organization?${new URLSearchParams({ state, ...(cursor ? { cursor } : {}) })}`, boardSchema)
export const getDecisions = (id: string) => api(`/organization/${id}`, boardSchema)
export const getExitImpact = (id: string) => api(`/organization/${id}/exit-impact`, exitSchema)
export const supplyLabels = {
  planned: '计划中',
  purchased: '已购待入库',
  completed: '已完成',
  cancelled: '暂不需要',
}
export const decisionLabels = {
  suggested: '待评估',
  observe: '待观察',
  pending: '待处理',
  keep: '继续保留',
  repair: '维修 / 改衣中',
  done: '已处理',
  undecided: '已撤销决定',
}
export const seasonLabel = (s: string) =>
  ({ spring: '春', summer: '夏', autumn: '秋', winter: '冬' })[s] ?? s
