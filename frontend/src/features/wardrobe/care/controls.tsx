import { LocationInput } from '../locations/input'
import { Button } from '../../../components/ui/button'
import { actions, type CareAction } from './api'
import type { CareDraft } from './state'

const groups: { label: string; values: CareAction[] }[] = [
  { label: '洗衣状态', values: ['mark_washing', 'wash_done'] },
  { label: '标签整理', values: ['tags_add', 'tags_remove'] },
  { label: '收纳位置', values: ['location_set', 'location_clear'] },
]

export function CareControls({
  draft,
  onChange,
  tags,
  busy,
  loading = false,
}: {
  draft: CareDraft
  onChange: (d: CareDraft) => void
  tags: { id: string; name: string }[]
  busy: boolean
  loading?: boolean
}) {
  return (
    <fieldset disabled={busy} className="care-controls">
      <legend>这次要做什么</legend>
      <label>
        批量操作
        <select
          value={draft.action}
          onChange={(e) => onChange({ ...draft, action: e.target.value as CareAction })}
        >
          {groups.map(({ label, values }) => (
            <optgroup key={label} label={label}>
              {values.map((v) => (
                <option key={v} value={v}>
                  {actions[v]}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
      </label>
      {draft.action.startsWith('tags_') && (
        <>
          <p className="muted">只增减选中的标签，其他标签保留。</p>
          {loading ? (
            <p role="status">正在读取标签…</p>
          ) : (
            !tags.length && <p>暂无标签，请先在衣橱的“标签”中创建。</p>
          )}
          <div className="care-tags" role="group" aria-label="选择标签">
            {tags.map((t) => (
              <label key={t.id}>
                <input
                  type="checkbox"
                  checked={draft.tag_ids.includes(t.id)}
                  disabled={!draft.tag_ids.includes(t.id) && draft.tag_ids.length >= 30}
                  onChange={() =>
                    onChange({
                      ...draft,
                      tag_ids: draft.tag_ids.includes(t.id)
                        ? draft.tag_ids.filter((id) => id !== t.id)
                        : [...draft.tag_ids, t.id],
                    })
                  }
                />
                {t.name}
              </label>
            ))}
          </div>
          {draft.tag_ids.some((id) => !tags.some((t) => t.id === id)) && (
            <div role="alert">
              <p>所选标签已删除或尚未读取，请重新核对。</p>
              <Button variant="outline" onClick={() => onChange({ ...draft, tag_ids: [] })}>
                清除标签选择
              </Button>
            </div>
          )}
        </>
      )}
      {draft.action === 'location_set' && (
        <LocationInput
          label="新收纳位置"
          value={draft.location}
          disabled={busy}
          onChange={(value) => onChange({ ...draft, location: value })}
        />
      )}
      {draft.action === 'location_clear' && (
        <p className="notice">将清空所选单品的位置；可穿状态和日常/换季收纳状态保持。</p>
      )}
      {draft.action === 'mark_washing' && (
        <p className="muted">可穿单品标为待洗；维修或其他不可穿原因会保留并提示冲突。</p>
      )}
      {draft.action === 'wash_done' && (
        <p className="muted">仅待洗单品恢复可穿。维修或其他不可穿状态不会被清除。</p>
      )}
    </fieldset>
  )
}
