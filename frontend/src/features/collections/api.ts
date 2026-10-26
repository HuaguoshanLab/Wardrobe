import { z } from 'zod'
import type { components } from '../../generated/api'
import { api } from '../../lib/http'
import { revisionSchema } from '../outfits'

export const historySchema = z.object({
  revision: revisionSchema,
  version: z.int(),
  hidden_from_history_at: z.string().nullable(),
}) satisfies z.ZodType<components['schemas']['HistoryEntry']>
export const favoriteSchema = z.object({
  id: z.uuid(),
  revision_id: z.uuid(),
  name: z.string(),
  version: z.int(),
  created_at: z.string(),
  revision: revisionSchema,
}) satisfies z.ZodType<components['schemas']['FavoriteView']>
export const wearSchema = z.object({
  id: z.uuid(),
  revision_id: z.uuid(),
  worn_on: z.string(),
  timezone: z.string(),
  notes: z.string(),
  version: z.int(),
  created_at: z.string(),
  revision: revisionSchema,
}) satisfies z.ZodType<components['schemas']['WearView']>
export const getHistory = (cursor?: string) =>
  api(
    `/outfit-revisions?limit=20${cursor ? `&cursor=${cursor}` : ''}`,
    z.object({ items: z.array(historySchema), next_cursor: z.uuid().nullable() }),
  )
export const getFavorites = (cursor?: string) =>
  api(
    `/favorites?limit=20${cursor ? `&cursor=${cursor}` : ''}`,
    z.object({ items: z.array(favoriteSchema), next_cursor: z.uuid().nullable() }),
  )
export const getWears = (start: string, end: string, cursor?: string) =>
  api(
    `/wear-records?limit=20&start=${start}&end=${end}${cursor ? `&cursor=${cursor}` : ''}`,
    z.object({ items: z.array(wearSchema), next_cursor: z.uuid().nullable() }),
  )
export const getRevision = (id: string) => api(`/outfit-revisions/${id}`, revisionSchema)
export const today = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
