import { z } from 'zod'
import type { components } from '../../generated/api'
import { api } from '../../lib/http'

export const capabilitiesSchema = z.object({
  provider_mode: z.string(),
  model: z.string(),
  recognition: z.string(),
  weather: z.string(),
  cutout: z.string(),
  maintenance: z.boolean(),
  data_epoch: z.uuid(),
}) satisfies z.ZodType<components['schemas']['Capabilities']>

export const jobSchema = z.object({
  id: z.uuid(),
  kind: z.literal('diagnostic'),
  status: z.enum([
    'queued',
    'running',
    'cancel_requested',
    'succeeded',
    'failed',
    'interrupted',
    'cancelled',
  ]),
  result: z.object({ provider_mode: z.literal('fake'), message: z.string() }).nullable(),
  error: z
    .object({
      code: z.string(),
      message: z.string(),
      details: z.array(z.record(z.string(), z.json())),
      retryable: z.boolean(),
    })
    .nullable(),
  retry_of_job_id: z.uuid().nullable(),
  last_seq: z.int(),
  created_at: z.string(),
  updated_at: z.string(),
}) satisfies z.ZodType<components['schemas']['JobView']>

export const inputSchema = z.object({ message: z.string().min(1).max(200) })
export const acceptedSchema = z.object({ job_id: z.uuid(), status: jobSchema.shape.status })
export type Job = z.infer<typeof jobSchema>
export const isTerminal = (status?: string) =>
  ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(status ?? '')
export const getCapabilities = () => api('/capabilities', capabilitiesSchema)
export const getJob = (id: string) => api(`/jobs/${id}`, jobSchema)
