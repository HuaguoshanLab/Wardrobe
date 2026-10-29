import { z } from 'zod'
import type { components } from '../../generated/api'
import { api } from '../../lib/http'

export const profileSchema = z.object({
  source: z.enum(['purchased', 'gift', 'other']).nullable().default(null),
  acquired_on: z.string().nullable().default(null),
  price: z.string().nullable().default(null),
  location: z.string().nullable().default(null),
  condition: z.enum(['unknown', 'good', 'worn', 'needs_repair', 'damaged']).default('unknown'),
  fit: z.enum(['unknown', 'fits', 'unfit', 'not_applicable']).default('unknown'),
  storage: z.enum(['daily', 'stored']).default('daily'),
  unavailable_reason: z.enum(['washing', 'repair', 'other']).nullable().default(null),
  decision: z.enum(['undecided', 'keep', 'pending']).default('undecided'),
  decision_reason: z.string().default(''),
  notes: z.string().default(''),
  exit_reason: z
    .enum(['gifted', 'sold', 'recycled', 'discarded', 'other'])
    .nullable()
    .default(null),
  exited_on: z.string().nullable().default(null),
})
const _profileContract: z.ZodType<components['schemas']['LifecycleProfile']> = profileSchema
void _profileContract
export const eventSchema = z.object({
  id: z.uuid(),
  action: z.string(),
  occurred_on: z.string(),
  recorded_at: z.string(),
  reason: z.string(),
  version: z.int(),
  related_event_id: z.uuid().nullable(),
  before: z.record(z.string(), z.json()),
  after: z.record(z.string(), z.json()),
})
export const getLifecycle = (id: string, cursor?: number) =>
  api(
    `/garments/${id}/lifecycle${cursor ? `?cursor=${cursor}` : ''}`,
    z.object({
      last_exit_event_id: z.uuid().nullable().default(null),
      items: z.array(eventSchema),
      next_cursor: z.int().nullable(),
      wear_days: z.int(),
      first_worn_on: z.string().nullable(),
      last_worn_on: z.string().nullable(),
    }),
  )
export const subtypeSchema = z.object({
  id: z.uuid(),
  category: z.string(),
  name: z.string(),
  active: z.boolean().default(true),
  version: z.int().default(1),
})
export const getSubtypes = () => api('/garment-subtypes', z.array(subtypeSchema))
export type LifecycleAction = components['schemas']['LifecycleInput']['action']
export type LifecycleEvent = z.infer<typeof eventSchema>
export type Subtype = z.infer<typeof subtypeSchema>
export const lifecycleNames: Record<LifecycleAction, string> = {
  profile: '补充获得资料',
  condition: '更新状况',
  storage: '收纳与取出',
  availability: '修改可用状态',
  repair_start: '开始维修',
  repair_complete: '完成维修',
  decision: '整理决定',
  retire: '退出衣橱',
  restore: '撤销退出',
  correct: '更正记录',
}
export const labels = {
  source: { '': '未知', purchased: '购买', gift: '获赠', other: '其他' },
  condition: {
    unknown: '未知',
    good: '完好',
    worn: '轻微磨损',
    needs_repair: '需要维修',
    damaged: '严重损坏',
  },
  fit: { unknown: '未知', fits: '合身', unfit: '不合身', not_applicable: '不适用' },
  storage: { daily: '日常存放', stored: '换季收纳' },
  availability: { available: '可穿', unavailable: '暂不可用' },
  unavailable_reason: { '': '未说明', washing: '待洗', repair: '维修', other: '其他' },
  decision: { undecided: '未决定', keep: '继续保留', pending: '待处理' },
  exit_reason: { gifted: '转赠', sold: '出售', recycled: '回收', discarded: '丢弃', other: '其他' },
}
export const today = () =>
  new Intl.DateTimeFormat('sv-SE', { timeZone: 'Asia/Shanghai' }).format(new Date())
