import { useEffect, useRef, useState } from 'react'
import { keepPreviousData, useInfiniteQuery } from '@tanstack/react-query'
import { Check, MapPin, Search, X } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { getLocations, locationScope, type LocationSelection } from './api'
import './locations.css'

export function LocationChoices({
  filters = {},
  selected,
  onSelect,
  reuse = false,
  disabled = false,
  onDismiss,
}: {
  filters?: Record<string, string>
  selected?: LocationSelection
  onSelect: (value: LocationSelection) => void
  reuse?: boolean
  disabled?: boolean
  onDismiss?: () => void
}) {
  const [search, setSearch] = useState('')
  const [queryText, setQueryText] = useState('')
  const searchInput = useRef<HTMLInputElement>(null)
  useEffect(() => {
    const timer = setTimeout(() => setQueryText(search), 250)
    return () => clearTimeout(timer)
  }, [search])
  const params = locationScope(filters)
  params.set('location_q', queryText)
  const query = useInfiniteQuery({
    queryKey: ['garments', 'locations', params.toString()],
    initialPageParam: '',
    placeholderData: keepPreviousData,
    queryFn: ({ pageParam }) => {
      const next = new URLSearchParams(params)
      if (pageParam) next.set('cursor', pageParam)
      return getLocations(next)
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const summary = query.data?.pages[0]
  const items = Array.from(
    new Map(query.data?.pages.flatMap((p) => p.items).map((i) => [i.location, i]) ?? []).values(),
  )
  const stale = search !== queryText || query.isPlaceholderData
  const clearSearch = () => {
    setSearch('')
    searchInput.current?.focus()
  }
  const current =
    selected?.mode === 'named'
      ? selected.location
      : selected?.mode === 'unassigned'
        ? '未填写位置'
        : selected
          ? '全部位置'
          : undefined
  const option = (label: string, count: number, value: LocationSelection) => {
    const active =
      selected?.mode === value.mode &&
      (value.mode !== 'named' || selected.location === value.location)
    return (
      <Button
        key={label}
        variant="outline"
        aria-label={`${label} ${count} 件`}
        aria-pressed={active}
        disabled={disabled || stale}
        onClick={() => onSelect(value)}
      >
        <span className="location-option-name">
          <MapPin size={17} aria-hidden="true" />
          {label}
        </span>
        <span className="location-option-meta">
          {count} 件{active && <Check size={18} aria-hidden="true" />}
        </span>
      </Button>
    )
  }
  return (
    <div className="location-choices">
      {current && (
        <details className="location-current">
          <summary>
            <Check size={16} aria-hidden="true" />
            <span>
              {reuse ? '当前输入' : '当前选择'}：{current}
            </span>
            <span className="location-current-hint">查看</span>
          </summary>
          <p>{current}</p>
        </details>
      )}
      <label className="location-search-label">
        搜索已有位置
        <span className="location-search-box">
          <Search size={18} aria-hidden="true" />
          <input
            ref={searchInput}
            type="search"
            maxLength={120}
            value={search}
            disabled={disabled}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="例如：衣柜、收纳箱"
          />
          {search && (
            <Button
              variant="outline"
              className="location-search-clear"
              aria-label="清空位置搜索"
              disabled={disabled}
              onClick={clearSearch}
            >
              <X size={18} aria-hidden="true" />
            </Button>
          )}
        </span>
      </label>
      {reuse ? (
        <p className="location-help">选择只填入草稿，保存后生效。</p>
      ) : (
        <p className="location-help">按当前衣橱筛选统计 · 不含示例</p>
      )}
      {!reuse && summary && (
        <div className="location-options location-scope" role="group" aria-label="位置范围">
          {option('全部位置', summary.total_garments, { mode: 'all' })}
          {option('未填写位置', summary.unassigned_count, { mode: 'unassigned' })}
        </div>
      )}
      <p className="location-list-heading" role="status" aria-atomic="true">
        {query.isPending
          ? '正在读取位置…'
          : stale
            ? '正在搜索…'
            : summary
              ? `找到 ${summary.matching_locations} 个已填位置`
              : '已有位置'}
      </p>
      {query.isError && (
        <div role="alert" className="location-message">
          <strong>{query.isFetchNextPageError ? '更多位置未能加载' : '位置暂时无法读取'}</strong>
          <p>{query.error.message}</p>
          <Button
            variant="outline"
            disabled={query.isFetching || disabled}
            onClick={() =>
              void (query.isFetchNextPageError ? query.fetchNextPage() : query.refetch())
            }
          >
            {query.isFetchNextPageError ? '重试加载更多位置' : '重新读取位置'}
          </Button>
        </div>
      )}
      <div
        className="location-options location-names"
        role="group"
        aria-label="已有位置"
        aria-busy={query.isFetching}
      >
        {items.map((item) =>
          option(item.location, item.count, { mode: 'named', location: item.location }),
        )}
      </div>
      {!query.isError && summary && !items.length && !stale && (
        <div className="location-message">
          <strong>{search.trim() ? '没有匹配的位置' : '还没有已填写的位置'}</strong>
          <p>
            {search.trim()
              ? '试试较短的关键词，或清空搜索查看已有位置。'
              : reuse
                ? '还没有已填写的位置，可直接输入新位置。'
                : '可查看“未填写位置”，或返回衣橱调整筛选。'}
          </p>
          {search && (
            <Button variant="outline" disabled={disabled} onClick={clearSearch}>
              清空搜索，查看全部位置
            </Button>
          )}
        </div>
      )}
      {query.hasNextPage && !query.isFetchNextPageError && (
        <Button
          variant="outline"
          disabled={query.isFetching || stale || disabled}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? '正在读取…' : '加载更多位置'}
        </Button>
      )}
      {onDismiss && (
        <Button variant="outline" disabled={disabled} onClick={onDismiss}>
          返回手动填写
        </Button>
      )}
      <details className="location-count-help">
        <summary>数量说明</summary>
        <p>
          {reuse ? '来自当前持有的真实单品。' : '数量随名称、品类、季节、档案范围等条件变化。'}
          待洗、维修和换季收纳仍计入实际位置。搜索位置名称不改变“全部位置”和“未填写位置”的数量。
        </p>
      </details>
    </div>
  )
}
