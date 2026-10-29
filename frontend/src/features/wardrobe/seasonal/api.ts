import { z } from 'zod'
import type { components } from '../../../generated/api'
import { api } from '../../../lib/http'
import { garmentSchema } from '../api'
import { inventorySchema, seasonSchema } from '../inventory/api'

export const stages = {
  review: '核对单品',
  targets: '调整目标',
  actions: '逐件处理',
  summary: '整理总结',
} as const
export const stageSchema = z.enum(['review', 'targets', 'actions', 'summary'])
const briefSchema = z.object({
  id: z.uuid(),
  season: seasonSchema,
  scope: z.enum(['all', 'season']),
  categories: z.array(z.string()),
  version: z.int(),
  stage: stageSchema,
  created_at: z.string(),
  completed_at: z.string().nullable(),
})
export const itemSchema = z.object({
  garment_id: z.uuid(),
  original: garmentSchema,
  current: garmentSchema.nullable(),
  reviewed_version: z.int().nullable(),
  stale: z.boolean(),
  todo: z.string(),
})
export const actionSchema = z.object({
  id: z.uuid(),
  garment_id: z.uuid(),
  operation: z.object({
    expected_version: z.int(),
    action: z.enum([
      'profile',
      'condition',
      'storage',
      'availability',
      'repair_start',
      'repair_complete',
      'decision',
      'retire',
      'restore',
      'correct',
    ]),
    occurred_on: z.string(),
    reason: z.string(),
    changes: z.record(z.string(), z.json()),
    related_event_id: z.uuid().nullable(),
    impact_token: z.string().nullable(),
  }),
  success: z.boolean(),
  message: z.string(),
  garment: garmentSchema.nullable(),
})
const summarySchema = z.object({
  stats_at: z.string(),
  rules_token: z.string(),
  inventory: inventorySchema,
  items: z.array(itemSchema),
  actions: z.array(actionSchema),
  reviewed: z.int(),
  total: z.int(),
  unresolved: z.array(z.string()),
  outside_scope: z.int(),
})
export const sessionSchema = briefSchema.extend({
  items: z.array(itemSchema),
  inventory: inventorySchema,
  actions: z.array(actionSchema),
  target_token: z.string(),
  targets_confirmed: z.boolean(),
  preview_token: z.string(),
  preview: summarySchema,
  summary: summarySchema.nullable(),
})
const _contract: z.ZodType<components['schemas']['SeasonalView']> = sessionSchema
void _contract
export type Seasonal = z.infer<typeof sessionSchema>
export type SeasonalItem = z.infer<typeof itemSchema>
export type Stage = keyof typeof stages
export const getSession = (id: string) => api(`/seasonal-sessions/${id}`, sessionSchema)
export const getSessions = (cursor = '') =>
  api(
    `/seasonal-sessions${cursor ? `?cursor=${cursor}` : ''}`,
    z.object({ items: z.array(briefSchema), next_cursor: z.uuid().nullable() }),
  )
