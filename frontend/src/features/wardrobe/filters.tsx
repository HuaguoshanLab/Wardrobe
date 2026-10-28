import { useEffect, useRef, useState } from 'react'
import { Search, SlidersHorizontal, X } from 'lucide-react'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'
import { Choices } from './choices'

type Props = {
  filters: Record<string, string>
  fields: Record<string, Record<string, string>>
  filter: (key: string, value: string) => void
}

export function CategoryRail({ filters, fields, filter }: Props) {
  return (
    <div className="category-rail" role="group" aria-label="品类筛选">
      {[['', '全部'], ...Object.entries(fields.category ?? {})].map(([code, name]) => (
        <button
          key={code}
          aria-pressed={(filters.category ?? '') === code}
          onClick={() => filter('category', code)}
        >
          {name}
        </button>
      ))}
    </div>
  )
}

export function WardrobeFilters({
  filters,
  fields,
  filter,
  tags,
  resetExtra,
}: Props & {
  tags: { id: string; name: string }[]
  resetExtra: () => void
}) {
  const [open, setOpen] = useState(false)
  const [search, setSearch] = useState(filters.q ?? '')
  const [tagSearch, setTagSearch] = useState('')
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const latestFilter = useRef(filter)
  latestFilter.current = filter
  useEffect(() => {
    clearTimeout(timer.current)
    setSearch(filters.q ?? '')
  }, [filters.q])
  useEffect(() => () => clearTimeout(timer.current), [])
  const extraCount = ['occasion', 'availability', 'tag_id'].filter((key) => filters[key]).length
  const names: Record<string, string> = {
    q: filters.q,
    category: fields.category?.[filters.category] ?? filters.category,
    season: fields.seasons?.[filters.season] ?? filters.season,
    occasion: fields.occasion_codes?.[filters.occasion] ?? filters.occasion,
    availability: filters.availability === 'available' ? '可穿' : '暂不可用',
    tag_id: tags.find((tag) => tag.id === filters.tag_id)?.name ?? '已删除标签',
  }
  return (
    <div className="wardrobe-controls">
      <div className="wardrobe-search-row">
        <label className="wardrobe-search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="搜索衣服"
            type="search"
            placeholder="搜索衣服名称"
            value={search}
            onChange={(e) => {
              const value = e.target.value
              setSearch(value)
              clearTimeout(timer.current)
              timer.current = setTimeout(() => latestFilter.current('q', value), 300)
            }}
          />
        </label>
        <Sheet
          title="更多筛选"
          open={open}
          onOpenChange={setOpen}
          trigger={
            <button className="wardrobe-more">
              <SlidersHorizontal size={18} aria-hidden="true" />
              筛选{extraCount > 0 && <span>{extraCount}</span>}
            </button>
          }
        >
          <div className="wardrobe-extra-filters">
            <Choices
              label="状态"
              options={{ '': '全部状态', available: '可穿', unavailable: '暂不可用' }}
              selected={[filters.availability ?? '']}
              onChange={(value) => filter('availability', value)}
            />
            <Choices
              label="场合"
              options={{ '': '全部场合', ...fields.occasion_codes }}
              selected={[filters.occasion ?? '']}
              onChange={(value) => filter('occasion', value)}
            />
            {tags.length > 8 && (
              <input
                aria-label="搜索标签"
                placeholder="搜索标签"
                value={tagSearch}
                onChange={(e) => setTagSearch(e.target.value)}
              />
            )}
            <Choices
              label="自定义标签"
              options={{
                '': '全部标签',
                ...Object.fromEntries(
                  tags
                    .filter((tag) => tag.name.includes(tagSearch))
                    .map((tag) => [tag.id, tag.name]),
                ),
              }}
              selected={[filters.tag_id ?? '']}
              onChange={(value) => filter('tag_id', value)}
            />
            {!tags.length && <p className="muted">还没有标签，可在衣橱顶部「管理标签」中添加。</p>}
            <p className="muted">选择即生效，每组可选一项。</p>
            <div className="actions">
              <Button variant="outline" disabled={!extraCount} onClick={resetExtra}>
                重置更多筛选
              </Button>
              <Button onClick={() => setOpen(false)}>查看结果</Button>
            </div>
          </div>
        </Sheet>
      </div>
      <div className="season-tabs" role="group" aria-label="季节筛选">
        {[['', '全部季节'], ...Object.entries(fields.seasons ?? {})].map(([code, name]) => (
          <button
            key={code}
            aria-pressed={(filters.season ?? '') === code}
            onClick={() => filter('season', code)}
          >
            {name}
          </button>
        ))}
      </div>
      {Object.keys(names).some((key) => filters[key]) && (
        <div className="wardrobe-active-filters" aria-label="已选筛选">
          {Object.entries(names)
            .filter(([key]) => filters[key])
            .map(([key, name]) => (
              <button key={key} aria-label={`移除筛选：${name}`} onClick={() => filter(key, '')}>
                {name}
                <X size={14} aria-hidden="true" />
              </button>
            ))}
        </div>
      )}
    </div>
  )
}
