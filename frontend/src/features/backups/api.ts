import { z } from 'zod'
import type { components } from '../../generated/api'
import { api } from '../../lib/http'

export const acceptedSchema = z.object({ job_id: z.uuid(), status: z.string() })
const resultSchema = z.object({
  backup_id: z.uuid().nullable(),
  restore_id: z.uuid().nullable(),
  format_version: z.int(),
  sha256: z.string().nullable(),
  download_url: z.string().nullable(),
  data_epoch: z.uuid().nullable(),
  refresh_required: z.boolean(),
  summary: z.record(z.string(), z.int()),
}) satisfies z.ZodType<components['schemas']['BackupResult']>
export const jobSchema = z.object({
  id: z.uuid(),
  status: z.string(),
  result: resultSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
})
export const restoreSchema = z.object({
  restore_id: z.uuid(),
  status: z.enum([
    'validating',
    'ready',
    'invalid',
    'expired',
    'queued',
    'running',
    'succeeded',
    'failed',
    'interrupted',
  ]),
  message: z.string(),
  sha256: z.string().nullable(),
  confirmation_token: z.string().nullable(),
  expires_at: z.string().nullable(),
  target_data_epoch: z.uuid().nullable(),
  summary: z.record(z.string(), z.int()),
  job_id: z.uuid().nullable(),
}) satisfies z.ZodType<components['schemas']['RestoreView']>
export const getRestore = (id: string) => api(`/restores/${id}`, restoreSchema)
export const getBackupJob = (id: string) => api(`/jobs/${id}`, jobSchema)
export const terminal = (status?: string) =>
  ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(status ?? '')
