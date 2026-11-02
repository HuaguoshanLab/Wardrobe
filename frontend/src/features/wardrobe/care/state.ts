import { useState } from 'react'
import { z } from 'zod'
import { garmentSchema, type Garment } from '../api'
import { actionSchema, type CareAction } from './api'

export const draftSchema = z.object({
  selected: z.array(garmentSchema).max(20),
  action: actionSchema,
  tag_ids: z.array(z.uuid()).max(30),
  location: z.string().max(120),
})
export type CareDraft = z.infer<typeof draftSchema>
export const initialDraft: CareDraft = {
  selected: [],
  action: 'wash_done',
  tag_ids: [],
  location: '',
}
export function readStored<T>(key: string, schema: z.ZodType<T>): T | null {
  try {
    return schema.parse(JSON.parse(localStorage.getItem(key) ?? 'null'))
  } catch {
    return null
  }
}
export function useCareDraft(defaultAction: CareAction = 'wash_done') {
  const [draft, set] = useState(
    () =>
      readStored('wardrobe.care.draft', draftSchema) ?? { ...initialDraft, action: defaultAction },
  )
  const [storageError, setStorageError] = useState('')
  function update(next: CareDraft) {
    try {
      localStorage.setItem('wardrobe.care.draft', JSON.stringify(next))
      set(next)
      setStorageError('')
    } catch {
      setStorageError('浏览器无法保存草稿，请释放存储空间后重试。')
    }
  }
  function toggle(item: Garment) {
    const exists = draft.selected.some((g) => g.id === item.id)
    if (!exists && draft.selected.length >= 20) return
    update({
      ...draft,
      selected: exists ? draft.selected.filter((g) => g.id !== item.id) : [...draft.selected, item],
    })
  }
  return { draft, update, toggle, storageError }
}
export function status(item: Garment) {
  if (item.ownership === 'retired') return '已退出衣橱'
  if (item.is_demo) return '示例单品'
  if (item.availability === 'available') return '可穿'
  return (
    ({ washing: '待洗', repair: '维修中', other: '其他原因不可穿' } as Record<string, string>)[
      item.lifecycle.unavailable_reason ?? ''
    ] ?? '暂不可穿（原因未填）'
  )
}
