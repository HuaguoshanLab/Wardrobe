import { z } from 'zod'
import { api } from '../../lib/http'
import { revisionSchema } from '../outfits'
import type { components } from '../../generated/api'

export const clueSchema = z.object({
  category: z.enum([
    'top',
    'bottom',
    'dress',
    'outerwear',
    'shoes',
    'bag',
    'hat',
    'scarf',
    'belt',
    'jewelry',
    'other_accessory',
  ]),
  color_codes: z.array(z.string()).max(5),
  style_codes: z.array(z.string()).max(3),
  layer: z.enum(['unknown', 'inner', 'outer', 'single']),
})
export type Clue = z.infer<typeof clueSchema>
export const referenceSchema = z.object({
  id: z.uuid(),
  version: z.int(),
  image_url: z.string(),
  analysis: z
    .object({
      subject: z.enum(['single', 'multiple', 'unclear']),
      clues: z.array(clueSchema),
      warnings: z.array(z.string()),
    })
    .nullable(),
  clues: z.array(clueSchema),
  confirmed: z.boolean(),
  current_job_id: z.uuid().nullable(),
  revision_ids: z.array(z.uuid()),
  provider_mode: z.string().nullable(),
  created_at: z.string(),
}) satisfies z.ZodType<components['schemas']['ReferenceView']>
export type Reference = z.infer<typeof referenceSchema>
export const getReference = (id: string) => api(`/references/${id}`, referenceSchema)
export const getReferences = (offset: number) =>
  api(`/references?offset=${offset}`, z.array(referenceSchema))
export const getRevision = (id: string) => api(`/outfit-revisions/${id}`, revisionSchema)
const status = z.enum([
  'queued',
  'running',
  'cancel_requested',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
])
const jobSchema = z.object({
  id: z.uuid(),
  status,
  error: z.object({ message: z.string() }).nullable(),
  result: z.object({ no_match: z.boolean() }).passthrough().nullable(),
})
export const getJob = (id: string) => api(`/jobs/${id}`, jobSchema)
export const cancelJob = (id: string) => api(`/jobs/${id}/cancel`, jobSchema, { method: 'POST' })
export const terminal = (s?: string) =>
  !!s && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(s)
