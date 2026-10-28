import { api } from '../../lib/http'
import { z } from 'zod'
import { getAllFavorites, getHistory, wearSchema, type Wear } from './api'
import type { RecordAction } from './action-form'

export async function refreshAction(action: RecordAction): Promise<RecordAction> {
  if ('favorite' in action && action.favorite) {
    const latest = (await getAllFavorites()).find((item) => item.id === action.favorite!.id)
    if (!latest) throw new Error('这条收藏已不存在。请关闭面板后重新选择操作。')
    return { ...action, favorite: latest }
  }
  if ('wear' in action && action.wear) {
    let cursor: string | null = null
    const seen = new Set<string>()
    do {
      const page: { items: Wear[]; next_cursor: string | null } = await api(
        `/wear-records?limit=100${cursor ? `&cursor=${cursor}` : ''}`,
        z.object({ items: z.array(wearSchema), next_cursor: z.uuid().nullable() }),
      )
      const latest = page.items.find((item) => item.id === action.wear!.id)
      if (latest) return { ...action, wear: latest }
      cursor = page.next_cursor
      if (cursor && seen.has(cursor)) throw new Error('分页读取异常，请重试')
      if (cursor) seen.add(cursor)
    } while (cursor)
    throw new Error('这条穿着记录已不存在。请关闭面板后重新选择操作。')
  }
  if (action.kind === 'remove-history') {
    let cursor: string | undefined
    const seen = new Set<string>()
    do {
      const page = await getHistory(cursor)
      const latest = page.items.find((item) => item.revision.id === action.revision.id)
      if (latest) return { ...action, history: latest }
      cursor = page.next_cursor ?? undefined
      if (cursor && seen.has(cursor)) throw new Error('分页读取异常，请重试')
      if (cursor) seen.add(cursor)
    } while (cursor)
    throw new Error('这套搭配已从历史移除。请关闭面板。')
  }
  return action
}
