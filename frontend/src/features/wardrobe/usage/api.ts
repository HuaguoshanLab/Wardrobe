import { z } from 'zod'
import type { components } from '../../../generated/api'
import { api } from '../../../lib/http'

export const usageItem = z.object({
  garment_id: z.uuid(),
  name: z.string().nullable(),
  category: z.string().nullable(),
  image_url: z.string().nullable(),
  availability: z.enum(['available', 'unavailable']),
  created_at: z.string(),
  wear_days: z.int().nonnegative(),
  last_worn_on: z.string().nullable(),
})
export const usageReport = z.object({
  range: z.enum(['30', '90', 'all']),
  view: z.enum(['worn', 'unrecorded']),
  as_of: z.string(),
  window_start: z.string().nullable(),
  timezone: z.literal('Asia/Shanghai'),
  total_garments: z.int().nonnegative(),
  recorded_garments: z.int().nonnegative(),
  unrecorded_garments: z.int().nonnegative(),
  recorded_ratio: z.number().min(0).max(1).nullable(),
  items: z.array(usageItem),
  total_items: z.int().nonnegative(),
  offset: z.int(),
  limit: z.int(),
  next_offset: z.int().nullable(),
})
const _contract: z.ZodType<components['schemas']['UsageReport']> = usageReport
void _contract
export type UsageItem = z.infer<typeof usageItem>
export type UsageReport = z.infer<typeof usageReport>
export function getUsage(range: string, view: string, offset: number) {
  return api(
    `/wardrobe/usage?${new URLSearchParams({ range, view, offset: String(offset), limit: '20' })}`,
    usageReport,
  )
}
