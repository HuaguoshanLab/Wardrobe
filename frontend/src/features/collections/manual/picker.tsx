import { useState } from 'react'
import { Check, Search } from 'lucide-react'
import { useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/button'
import { getGarments, getTaxonomy } from '../../wardrobe'
import { RecordImage } from '../preview'
import { pick, type Picked } from './state'
import './picker.css'

export function ManualPicker({
  items,
  onChange,
}: {
  items: Picked[]
  onChange: (items: Picked[]) => void
}) {
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [selectedOnly, setSelectedOnly] = useState(false)
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const query = useInfiniteQuery({
    queryKey: ['garments', 'manual-picker', search, category],
    initialPageParam: '',
    enabled: !selectedOnly,
    queryFn: ({ pageParam }) =>
      getGarments(
        new URLSearchParams({
          q: search,
          category,
          ownership: 'owned',
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })
  const garments = selectedOnly
    ? items
    : (query.data?.pages
        .flatMap((p) => p.items)
        .filter((g) => !g.is_demo && g.ownership === 'owned')
        .map(pick) ?? [])
  return (
    <div className="manual-picker">
      <div className="manual-picker-views" role="group" aria-label="选衣范围">
        <button type="button" aria-pressed={!selectedOnly} onClick={() => setSelectedOnly(false)}>
          我的衣橱
        </button>
        <button type="button" aria-pressed={selectedOnly} onClick={() => setSelectedOnly(true)}>
          已选（{items.length}）
        </button>
      </div>
      {!selectedOnly && (
        <>
          <form
            className="manual-search"
            onSubmit={(e) => {
              e.preventDefault()
              setSearch(text.trim())
            }}
          >
            <label>
              搜索衣服名称
              <input
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="输入名称找衣服"
              />
            </label>
            <Button type="submit" variant="outline">
              <Search size={18} aria-hidden="true" />
              搜索
            </Button>
          </form>
          <label className="manual-category">
            品类
            <select value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="">全部品类</option>
              {Object.entries(taxonomy.data?.fields.category ?? {}).map(([code, label]) => (
                <option key={code} value={code}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          {taxonomy.error && (
            <p role="alert">
              品类读取失败。<Button onClick={() => void taxonomy.refetch()}>重试品类</Button>
            </p>
          )}
        </>
      )}
      <p className="manual-picker-status" role="status" aria-atomic="true">
        {items.length === 20
          ? '已选满 20 件，取消一件后可继续选择。'
          : `已选 ${items.length} / 20 件${selectedOnly ? ' · 点击可取消选择' : ' · 切换筛选会保留选择'}`}
      </p>
      {!selectedOnly && query.isPending && <p role="status">正在读取衣橱…</p>}
      {!selectedOnly && query.error && (
        <p role="alert">
          {query.error.message}
          <Button onClick={() => void query.refetch()}>重试衣橱</Button>
        </p>
      )}
      {(selectedOnly || query.data) && !garments.length && (
        <div className="manual-picker-empty">
          <p>
            {selectedOnly
              ? '还没有选择衣服，先去衣橱看看。'
              : '没有匹配的正式单品，可调整筛选或先录入衣服。'}
          </p>
          {selectedOnly ? (
            <Button variant="outline" onClick={() => setSelectedOnly(false)}>
              去选衣服
            </Button>
          ) : (
            (search || category) && (
              <Button
                variant="outline"
                onClick={() => {
                  setText('')
                  setSearch('')
                  setCategory('')
                }}
              >
                清除筛选
              </Button>
            )
          )}
        </div>
      )}
      <div className="manual-picker-grid">
        {garments.map((g) => {
          const selected = items.some((i) => i.id === g.id)
          return (
            <button
              type="button"
              className="manual-pick"
              key={g.id}
              aria-pressed={selected}
              disabled={!selected && items.length >= 20}
              aria-label={`${selected ? '取消选择' : '选择'}：${g.name}`}
              onClick={() =>
                onChange(selected ? items.filter((i) => i.id !== g.id) : [...items, g])
              }
            >
              <div className="manual-pick-image">
                <RecordImage src={g.image_url} name={g.name} />
                <span className="manual-pick-check" aria-hidden="true">
                  {selected && <Check size={16} />}
                </span>
              </div>
              <strong>{g.name}</strong>
              <span className="manual-pick-status">
                {selected ? '已选择 · ' : ''}
                {g.issue ? '需重新核对' : g.availability === 'available' ? '可穿' : '暂不可用'}
              </span>
            </button>
          )
        })}
      </div>
      {!selectedOnly && query.hasNextPage && (
        <Button
          variant="outline"
          className="manual-load-more"
          disabled={query.isFetching}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetching ? '正在加载…' : '加载更多衣服'}
        </Button>
      )}
    </div>
  )
}
