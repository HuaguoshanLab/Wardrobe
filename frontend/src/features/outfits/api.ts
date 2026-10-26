import { z } from 'zod'
import type { components } from '../../generated/api'
import { api } from '../../lib/http'
import { requirementsSchema } from '../profile'

const itemSchema = z.object({
  item_id: z.uuid(),
  slot: z.string(),
  source: z.enum(['wardrobe', 'suggestion']),
  garment_id: z.uuid().nullable(),
  display_asset_id: z.uuid().nullable(),
  image_url: z.string().nullable(),
  attributes: z.record(z.string(), z.json()),
  description: z.string().nullable(),
})
export const revisionSchema = z.object({
  id: z.uuid(),
  session_id: z.uuid(),
  parent_revision_id: z.uuid().nullable(),
  run_id: z.uuid(),
  items: z.array(itemSchema),
  reason: z.string(),
  unmet_requirements: z.array(z.string()),
  weather_snapshot: z.record(z.string(), z.json()),
  request_snapshot: z.record(z.string(), z.json()),
  provider_mode: z.string(),
  created_at: z.string(),
}) satisfies z.ZodType<components['schemas']['RevisionView']>
export const messageSchema = z.object({
  id: z.uuid(),
  role: z.enum(['user', 'assistant']),
  content: z.string(),
  job_id: z.uuid().nullable(),
  revision_ids: z.array(z.uuid()),
  created_at: z.string(),
})
export const sessionSchema = z.object({
  id: z.uuid(),
  version: z.int(),
  requirements: requirementsSchema,
  selected_revision_id: z.uuid().nullable(),
  locked_garment_ids: z.array(z.uuid()),
  current_job_id: z.uuid().nullable(),
  latest_revision_ids: z.array(z.uuid()),
  revisions: z.array(revisionSchema),
  messages: z.array(messageSchema),
  invalid_garment_ids: z.array(z.uuid()),
  removed_lock_ids: z.array(z.uuid()),
}) satisfies z.ZodType<components['schemas']['SessionView']>
const status = z.enum([
  'queued',
  'running',
  'cancel_requested',
  'succeeded',
  'failed',
  'interrupted',
  'cancelled',
])
export const resultSchema = z.object({
  session_id: z.uuid(),
  revision_ids: z.array(z.uuid()),
  outcome: z.enum(['complete', 'partial', 'no_match', 'needs_clarification']),
  unmet_requirements: z.array(z.string()),
  question: z.string().nullable(),
})
export const outfitJobSchema = z.object({
  id: z.uuid(),
  kind: z.enum(['outfit_generate', 'outfit_adjust']),
  status,
  result: resultSchema.nullable(),
  error: z.object({ code: z.string(), message: z.string() }).nullable(),
  last_seq: z.int(),
})
export const acceptedSchema = z.object({ job_id: z.uuid(), status })
export type OutfitSession = z.infer<typeof sessionSchema>
export type Revision = z.infer<typeof revisionSchema>
export const getCurrent = () => api('/outfit-sessions/current', sessionSchema.nullable())
export const getSession = (id: string) => api(`/outfit-sessions/${id}`, sessionSchema.nullable())
export const getJob = (id: string) => api(`/jobs/${id}`, outfitJobSchema)
export const isTerminal = (value?: string) =>
  ['succeeded', 'failed', 'interrupted', 'cancelled'].includes(value ?? '')
