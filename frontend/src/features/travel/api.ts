import { z } from 'zod'
import { api, ApiError } from '../../lib/http'
import { operationId } from '../../lib/id'
import { citySchema } from '../profile'
import { revisionSchema } from '../outfits'
import type { components } from '../../generated/api'

export const inputSchema = z.object({
  name: z.string().trim().min(1).max(60),
  city: citySchema,
  days: z
    .array(
      z.object({
        date: z.string(),
        occasion: z.string(),
        weather: z
          .object({
            temperature_c: z.number().min(-90).max(60),
            condition: z.string().min(1).max(80),
          })
          .nullable(),
      }),
    )
    .min(1)
    .max(7),
  required_garment_ids: z.array(z.uuid()).max(20),
  target_count: z.number().int().min(1).max(50),
  allow_repeat: z.boolean(),
  notes: z.string().max(1000),
}) satisfies z.ZodType<components['schemas']['TravelInput']>
// Incomplete editor values must survive reload as well as valid submissions.
export const draftSchema = inputSchema.extend({
  name: z.string(),
  target_count: z
    .number()
    .nullable()
    .transform((value) => value ?? 10),
  days: z
    .array(
      z.object({
        date: z.string(),
        occasion: z.string(),
        weather: z
          .object({
            temperature_c: z
              .number()
              .nullable()
              .transform((value) => value ?? 20),
            condition: z.string(),
          })
          .nullable(),
      }),
    )
    .min(1)
    .max(7),
})
export type TravelInput = z.infer<typeof inputSchema>
export const daySchema = z.object({
  date: z.string(),
  occasion: z.string(),
  items: revisionSchema.shape.items,
  weather: z.record(z.string(), z.json()),
  warnings: z.array(z.string()),
})
export const travelRevision = z.object({
  id: z.uuid(),
  number: z.int(),
  days: z.array(daySchema),
  request: inputSchema,
  provider_mode: z.string(),
  warnings: z.array(z.string()),
  created_at: z.string(),
})
export const travelSchema = z.object({
  id: z.uuid(),
  version: z.int(),
  draft: inputSchema,
  current_job_id: z.uuid().nullable(),
  revision: travelRevision.nullable(),
  packing: z.array(
    z.object({
      garment_id: z.uuid(),
      item: revisionSchema.shape.items.element,
      dates: z.array(z.string()),
      packed: z.boolean(),
      added: z.boolean(),
    }),
  ),
  created_at: z.string(),
}) satisfies z.ZodType<components['schemas']['TravelView']>
export type Travel = z.infer<typeof travelSchema>
export type TravelRevision = z.infer<typeof travelRevision>
export const getTravel = (id: string) => api(`/travel-plans/${id}`, travelSchema)
export const getTravels = (offset = 0) =>
  api(`/travel-plans?offset=${offset}`, z.array(travelSchema))
export const getRevisions = (id: string, offset = 0) =>
  api(`/travel-plans/${id}/revisions?offset=${offset}`, z.array(travelRevision))
const status = z.enum([
  'queued',
  'running',
  'cancel_requested',
  'succeeded',
  'failed',
  'cancelled',
  'interrupted',
])
export const jobSchema = z.object({
  id: z.uuid(),
  status,
  error: z.object({ message: z.string(), code: z.string() }).nullable(),
})
export const getJob = (id: string) => api(`/jobs/${id}`, jobSchema)
export const cancelJob = (id: string) => api(`/jobs/${id}/cancel`, jobSchema, { method: 'POST' })
export const terminal = (s?: string) =>
  !!s && ['succeeded', 'failed', 'cancelled', 'interrupted'].includes(s)
export const today = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
export function consecutive(start: string, length: number) {
  const date = new Date(`${start}T12:00:00Z`)
  if (Number.isNaN(date.getTime())) return []
  return Array.from({ length }, (_, i) =>
    new Date(date.getTime() + i * 86400000).toISOString().slice(0, 10),
  )
}
const operationSchema = z.object({
  path: z.string(),
  method: z.enum(['POST', 'PATCH', 'DELETE']),
  body: z.string(),
  key: z.string(),
})
export type Operation = z.infer<typeof operationSchema>
const pendingKey = 'wardrobe.travel.operation'
export function pendingOperation() {
  try {
    return operationSchema.parse(JSON.parse(localStorage.getItem(pendingKey) ?? 'null'))
  } catch {
    return null
  }
}
export const forgetOperation = () => localStorage.removeItem(pendingKey)
export const operation = (
  path: string,
  body: object,
  method: Operation['method'] = 'POST',
): Operation => ({ path, body: JSON.stringify(body), method, key: operationId() })
export async function sendOperation(op: Operation) {
  localStorage.setItem(pendingKey, JSON.stringify(op))
  try {
    const result = await api(
      op.path,
      z.union([
        travelSchema,
        z.object({ job_id: z.uuid(), status }),
        z.object({ wear_record_id: z.uuid(), outfit_revision_id: z.uuid() }),
      ]),
      { method: op.method, body: op.body, headers: { 'Idempotency-Key': op.key } },
    )
    forgetOperation()
    return result
  } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) forgetOperation()
    throw error
  }
}
