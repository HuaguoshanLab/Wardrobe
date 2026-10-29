import { Search } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import type { SeasonalItem } from './api'

export function ItemFilter({
  search,
  onSearch,
  filter,
  onFilter,
  groups,
  disabled = false,
}: {
  search: string
  onSearch: (v: string) => void
  filter: string
  onFilter: (v: string) => void
  groups: { key: string; label: string; count: number }[]
  disabled?: boolean
}) {
  return (
    <div className="seasonal-filter">
      <label className="seasonal-search">
        <Search size={18} aria-hidden="true" />
        <span className="sr-only">搜索本轮单品</span>
        <input
          type="search"
          placeholder="搜索名称或待办"
          value={search}
          disabled={disabled}
          onChange={(e) => onSearch(e.target.value)}
        />
      </label>
      <div className="seasonal-filter-tabs" aria-label="单品分组">
        {groups.map((g) => (
          <Button
            key={g.key}
            variant="outline"
            aria-pressed={filter === g.key}
            disabled={disabled}
            onClick={() => onFilter(g.key)}
          >
            {g.label}
            <span>{g.count}</span>
          </Button>
        ))}
      </div>
    </div>
  )
}
export function matchesSearch(item: SeasonalItem, search: string) {
  return `${(item.current ?? item.original).name ?? ''} ${item.todo}`
    .toLocaleLowerCase()
    .includes(search.trim().toLocaleLowerCase())
}
