import { useState } from 'react'
import { Search, SlidersHorizontal } from 'lucide-react'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'

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
}: Props & { tags: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false)
  const extraCount = ['occasion', 'availability', 'tag_id'].filter((key) => filters[key]).length
  return (
    <div className="wardrobe-controls">
      <div className="wardrobe-search-row">
        <label className="wardrobe-search">
          <Search size={18} aria-hidden="true" />
          <input
            aria-label="搜索衣服"
            type="search"
            placeholder="搜索衣服名称"
            value={filters.q ?? ''}
            onChange={(e) => filter('q', e.target.value)}
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
            {(
              [
                ['occasion', '场合', 'occasion_codes'],
                ['availability', '状态', 'availability'],
              ] as const
            ).map(([key, label, field]) => (
              <label key={key}>
                {label}
                <select
                  aria-label={`筛选${label}`}
                  value={filters[key] ?? ''}
                  onChange={(e) => filter(key, e.target.value)}
                >
                  <option value="">全部{label}</option>
                  {Object.entries(fields[field] ?? {}).map(([code, name]) => (
                    <option key={code} value={code}>
                      {name}
                    </option>
                  ))}
                </select>
              </label>
            ))}
            <label>
              标签
              <select
                aria-label="筛选标签"
                value={filters.tag_id ?? ''}
                onChange={(e) => filter('tag_id', e.target.value)}
              >
                <option value="">全部标签</option>
                {tags.map((tag) => (
                  <option key={tag.id} value={tag.id}>
                    {tag.name}
                  </option>
                ))}
              </select>
            </label>
            <p className="muted">选择后即时筛选，关闭面板即可查看衣服。</p>
            <Button onClick={() => setOpen(false)}>查看结果</Button>
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
    </div>
  )
}
