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

export type Favorite = z.infer<typeof favoriteSchema>
export type Wear = z.infer<typeof wearSchema>
export type History = z.infer<typeof historySchema>

// Calendar markers and favorite state must not silently stop at the first page.
async function allPages<T>(
  read: (cursor?: string) => Promise<{ items: T[]; next_cursor: string | null }>,
) {
  const items: T[] = []
  const seen = new Set<string>()
  let cursor: string | undefined
  do {
    const page = await read(cursor)
    items.push(...page.items)
    cursor = page.next_cursor ?? undefined
    if (cursor && seen.has(cursor)) throw new Error('分页读取异常，请重试')
    if (cursor) seen.add(cursor)
  } while (cursor)
  return items
}
export const getAllFavorites = () => allPages(getFavorites)
export const getMonthWears = (month: string) => {
  const [year, number] = month.split('-').map(Number)
  const end = `${month}-${new Date(year, number, 0).getDate()}`
  return allPages((cursor) => getWears(`${month}-01`, end, cursor))
}
export const recordDay = (value: string) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(value))

export function isPastDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value > today() || value < '1900-01-01') return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value
}
