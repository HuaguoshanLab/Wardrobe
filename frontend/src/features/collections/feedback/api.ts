import { z } from 'zod'
import type { components } from '../../../generated/api'
import { api } from '../../../lib/http'
import { wearSchema } from '../api'

export const feedbackData = z.object({
  garment_id: z.uuid().nullable(),
  thermal: z.enum(['hot', 'cold', 'just_right']).nullable(),
  comfort: z.enum(['comfortable', 'neutral', 'uncomfortable']).nullable(),
  color: z.enum(['satisfied', 'neutral', 'unsatisfied']).nullable(),
  notes: z.string().max(500),
}) satisfies z.ZodType<components['schemas']['FeedbackData']>
export const feedbackView = z.object({
  wear_record_id: z.uuid(),
  version: z.int().nonnegative(),
  feedback: feedbackData.nullable(),
  updated_at: z.string().nullable(),
}) satisfies z.ZodType<components['schemas']['FeedbackView']>
export type Feedback = z.infer<typeof feedbackData>
export type FeedbackView = z.infer<typeof feedbackView>
export const emptyFeedback: Feedback = {
  garment_id: null,
  thermal: null,
  comfort: null,
  color: null,
  notes: '',
}
export const getFeedback = (id: string) => api(`/wear-records/${id}/feedback`, feedbackView)
export const getWear = (id: string) => api(`/wear-records/${id}`, wearSchema)
export const labels = {
  thermal: { hot: '偏热', cold: '偏冷', just_right: '冷热合适' },
  comfort: { comfortable: '舒适', neutral: '一般', uncomfortable: '不舒适' },
  color: { satisfied: '满意', neutral: '一般', unsatisfied: '不满意' },
}
export function feedbackText(data: Feedback, target: string, day: string) {
  const parts = [
    data.thermal && labels.thermal[data.thermal],
    data.comfort && `舒适度：${labels.comfort[data.comfort]}`,
    data.color && `配色：${labels.color[data.color]}`,
    data.notes,
  ].filter(Boolean)
  return `参考我在 ${day} 对${target}的穿着反馈：${parts.join('；')}。下次搭配请参考，仍以本次明确要求为准。`
}
