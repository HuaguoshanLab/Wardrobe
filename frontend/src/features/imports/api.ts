import { z } from 'zod'
import type { components } from '../../generated/api'
import { api } from '../../lib/http'
import { attributesSchema } from '../wardrobe'

export const rowSchema = z.object({
  id: z.uuid(),
  row_number: z.int(),
  filename: z.string(),
  image_asset_id: z.uuid().nullable(),
  image_url: z.string().nullable(),
  has_cutout: z.boolean(),
  draft: attributesSchema,
  version: z.int(),
  touched_fields: z.array(z.string()),
  validation_errors: z.array(z.string()),
  processing_errors: z.record(z.string(), z.json()),
  row_status: z.enum(['invalid', 'ready', 'confirmed', 'skipped']),
  conversion_status: z.string(),
  analysis_status: z.string(),
  cutout_status: z.string(),
  analysis_notes: z.array(z.string()),
  analysis_source: z.string().nullable(),
  confirmed_garment_id: z.uuid().nullable(),
})
export type ImportRow = z.infer<typeof rowSchema>
export const batchSchema = z.object({
  id: z.uuid(),
  source: z.string(),
  parent_job_id: z.uuid(),
  job_status: z.string(),
  job_error: z.string().nullable(),
  rows: z.array(rowSchema),
})
export const acceptedSchema = z.object({
  import_batch_id: z.uuid(),
  job_id: z.uuid(),
  status: z.string(),
})
export const confirmationSchema = z.object({
  rows: z.array(
    z.object({
      row_id: z.uuid(),
      status: z.enum(['confirmed', 'already_confirmed', 'invalid', 'version_conflict']),
      garment_id: z.uuid().nullable(),
      errors: z.array(z.string()),
    }),
  ),
})
export const getBatch = (id: string) => api(`/imports/${id}`, batchSchema)
export const terminal = new Set(['succeeded', 'failed', 'interrupted', 'cancelled'])
export const statusLabel: Record<string, string> = {
  queued: '排队中',
  running: '处理中',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
  cancelled: '已取消',
  cancel_requested: '正在取消',
  not_requested: '未请求',
  ready: '待确认',
  invalid: '需修正',
  confirmed: '已入库',
  skipped: '已移除',
}

const contracts: [
  z.ZodType<components['schemas']['RowView']>,
  z.ZodType<components['schemas']['BatchView']>,
  z.ZodType<components['schemas']['Confirmation']>,
] = [rowSchema, batchSchema, confirmationSchema]
void contracts
