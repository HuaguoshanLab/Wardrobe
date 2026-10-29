import { useState } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/button'
import { getGarments, type Garment } from '../api'

export function GarmentPicker({
  onSelect,
  excluded = [],
}: {
  onSelect: (g: Garment) => void
  excluded?: string[]
}) {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const garments = useInfiniteQuery({
    queryKey: ['garments', 'supply-picker', query],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      getGarments(
        new URLSearchParams({
          q: query,
          ownership: 'owned',
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })
  const items =
    garments.data?.pages
      .flatMap((p) => p.items)
      .filter((g) => !g.is_demo && !excluded.includes(g.id)) ?? []
  return (
    <div className="organization-picker">
      <form
        className="organization-search"
        onSubmit={(e) => {
          e.preventDefault()
          setQuery(search.trim())
        }}
      >
        <label>
          查找正式单品
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="输入衣服名称"
          />
        </label>
        <Button type="submit">搜索</Button>
      </form>
      {garments.isPending && <p role="status">正在读取衣橱…</p>}
      {garments.error && (
        <p role="alert">
          {garments.error.message}
          <Button onClick={() => void garments.refetch()}>重试衣橱</Button>
        </p>
      )}
      {garments.data && !items.length && <p>当前页没有可关联单品。可继续加载，或先录入衣服。</p>}
      {items.map((g) => (
        <Button
          className="organization-pick"
          variant="outline"
          key={g.id}
          onClick={() => onSelect(g)}
        >
          <img src={g.image_url} alt="" loading="lazy" />
          <span>
            {g.name ?? '未命名单品'}
            <small>已正式入库 · 点击选择</small>
          </span>
        </Button>
      ))}
      {garments.hasNextPage && (
        <Button
          disabled={garments.isFetchingNextPage}
          onClick={() => void garments.fetchNextPage()}
        >
          加载更多衣服
        </Button>
      )}
    </div>
  )
}
