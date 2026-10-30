import { z } from 'zod'
import { getGarment, type Garment } from '../../wardrobe'
import { getRevision, today, wearSchema } from '../api'
import { revisionSchema } from '../../outfits'
import type { components } from '../../../generated/api'

export const pickedSchema = z.object({
  id: z.uuid(),
  version: z.int(),
  name: z.string(),
  image_url: z.string(),
  availability: z.enum(['available', 'unavailable']),
  issue: z.string(),
})
export type Picked = z.infer<typeof pickedSchema>
export const pick = (g: Garment): Picked => ({
  id: g.id,
  version: g.version,
  name: g.name || '未命名单品',
  image_url: g.image_url,
  availability: g.availability,
  issue: g.is_demo || g.ownership !== 'owned' ? '已退出或不是正式单品，请移除' : '',
})
export const draftSchema = z.object({
  items: z.array(pickedSchema).max(20),
  mode: z.enum(['save', 'wear']),
  date: z.string(),
  notes: z.string(),
  acknowledged: z.boolean(),
})
export type Draft = z.infer<typeof draftSchema>
export const emptyDraft = (): Draft => ({
  items: [],
  mode: 'save',
  date: today(),
  notes: '',
  acknowledged: false,
})
export type ManualInput = components['schemas']['ManualOutfitInput']
export const resultSchema = z.object({
  revision: revisionSchema,
  wear: wearSchema.nullable(),
}) satisfies z.ZodType<components['schemas']['ManualOutfitResult']>
export type ManualResult = z.infer<typeof resultSchema>
export const pendingSchema = z.object({ key: z.string(), body: z.json() })

export async function refreshItems(items: Picked[]): Promise<Picked[]> {
  // A failed read keeps the selection visible, but blocks submitting an unchecked item.
  return Promise.all(
    items.map(async (item) => {
      try {
        return pick(await getGarment(item.id))
      } catch (error) {
        return { ...item, issue: error instanceof Error ? error.message : '读取失败，请重试' }
      }
    }),
  )
}
export async function fromParent(id: string): Promise<Draft> {
  const r = await getRevision(id)
  if (r.source !== 'manual') throw new Error('只能修改手动搭配')
  const items = r.items
    .filter((i) => i.source === 'wardrobe' && i.garment_id)
    .map((i) => ({
      id: i.garment_id!,
      version: 0,
      name: String(i.attributes.name || '未命名单品'),
      image_url: i.image_url || '',
      availability: 'available' as const,
      issue: '尚未核对',
    }))
  return { ...emptyDraft(), items: await refreshItems(items) }
}
