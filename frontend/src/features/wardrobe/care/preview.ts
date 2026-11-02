import type { Garment } from '../api'
import type { CareDraft } from './state'

export function changePreview(g: Garment, draft: CareDraft) {
  if (draft.action === 'mark_washing') return '目标：待洗'
  if (draft.action === 'wash_done') return '目标：可穿'
  if (draft.action === 'location_set') return `新位置：${draft.location.trim()}`
  if (draft.action === 'location_clear')
    return g.lifecycle.location ? '新位置：未填写（清空）' : '位置已未填写，无需修改'
  const existing = new Set(g.custom_tag_ids)
  const count = draft.tag_ids.filter((id) =>
    draft.action === 'tags_add' ? !existing.has(id) : existing.has(id),
  ).length
  return count
    ? `${draft.action === 'tags_add' ? '添加' : '移除'} ${count} 个标签，其他标签保留`
    : '标签已符合本次设置，无需修改'
}
export function changeConcern(g: Garment, draft: CareDraft) {
  if (g.ownership === 'retired' || g.is_demo) return '此单品不能批量处理，将保留原状态。'
  if (
    draft.action === 'wash_done' &&
    (g.availability !== 'unavailable' || g.lifecycle.unavailable_reason !== 'washing')
  )
    return '当前不是待洗状态，不会恢复可穿。'
  if (
    draft.action === 'mark_washing' &&
    g.availability === 'unavailable' &&
    g.lifecycle.unavailable_reason !== 'washing'
  )
    return '当前因其他原因不可穿，不会改为待洗。'
  return null
}
