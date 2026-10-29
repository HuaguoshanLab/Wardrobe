import { useDeferredValue, useState } from 'react'
import { Button } from '../../../components/ui/button'
import { ItemFilter, matchesSearch } from './item-filter'
import { latestFailed } from './action-history'
import type { Seasonal } from './api'

export function ActionPicker({
  session,
  selected,
  onSelect,
}: {
  session: Seasonal
  selected: string[]
  onSelect: (ids: string[]) => void
}) {
  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState('all')
  const deferred = useDeferredValue(search)
  const items = session.items.filter((i) => i.current?.ownership === 'owned')
  const failed = latestFailed(session)
  const groups = [
    { key: 'all', label: '全部可处理', count: items.length },
    { key: 'todo', label: '有待办', count: items.filter((i) => i.todo).length },
    {
      key: 'failed',
      label: '上次未成功',
      count: items.filter((i) => failed.has(i.garment_id)).length,
    },
    { key: 'selected', label: '已选', count: selected.length },
  ]
  const visible = items.filter(
    (i) =>
      matchesSearch(i, deferred) &&
      (filter === 'all' ||
        (filter === 'todo'
          ? !!i.todo
          : filter === 'failed'
            ? failed.has(i.garment_id)
            : selected.includes(i.garment_id))),
  )
  return (
    <div className="seasonal-picker">
      <ItemFilter
        search={search}
        onSearch={setSearch}
        filter={filter}
        onFilter={setFilter}
        groups={groups}
      />
      <div className="seasonal-selection">
        <strong>已选 {selected.length} / 20 件</strong>
        <span>切换分组会保留选择</span>
        {selected.length > 0 && (
          <Button variant="outline" onClick={() => onSelect([])}>
            清空选择
          </Button>
        )}
      </div>
      {!visible.length && (
        <p className="seasonal-empty">当前分组没有匹配单品，可切换分组或清空搜索。</p>
      )}
      <div className="seasonal-pick-list">
        {visible.map((i) => (
          <label className="seasonal-check seasonal-pick" key={i.garment_id}>
            <input
              type="checkbox"
              checked={selected.includes(i.garment_id)}
              disabled={!selected.includes(i.garment_id) && selected.length >= 20}
              onChange={(e) =>
                onSelect(
                  e.target.checked
                    ? [...selected, i.garment_id]
                    : selected.filter((id) => id !== i.garment_id),
                )
              }
            />
            <img src={i.current!.image_url} alt="" loading="lazy" />
            <span>
              <strong>{i.current!.name ?? '未命名单品'}</strong>
              <small>
                {i.todo || '暂无待办'}
                {i.stale ? ' · 需重新核对' : ''}
              </small>
            </span>
          </label>
        ))}
      </div>
    </div>
  )
}
