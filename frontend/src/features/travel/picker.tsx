import { useState } from 'react'
import { useInfiniteQuery, useQueries } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { getGarment, getGarments, GarmentImage } from '../wardrobe'

export function RequiredPicker({
  ids,
  onChange,
}: {
  ids: string[]
  onChange: (ids: string[]) => void
}) {
  const [text, setText] = useState('')
  const [search, setSearch] = useState('')
  const query = useInfiniteQuery({
    queryKey: ['garments', 'travel-picker', search],
    initialPageParam: '',
    queryFn: ({ pageParam }) =>
      getGarments(
        new URLSearchParams({
          q: search,
          ownership: 'owned',
          availability: 'available',
          ...(pageParam ? { cursor: pageParam } : {}),
        }),
      ),
    getNextPageParam: (p) => p.next_cursor ?? undefined,
  })
  const selected = useQueries({
    queries: ids.map((id) => ({
      queryKey: ['garment', id],
      queryFn: () => getGarment(id),
      retry: false,
    })),
  })
  return (
    <details>
      <summary>必带单品 · 已选 {ids.length}/20 件</summary>
      <p>每件必带单品至少安排一天。</p>
      <label>
        查找必带衣服
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              setSearch(text.trim())
            }
          }}
        />
      </label>
      <Button type="button" variant="outline" onClick={() => setSearch(text.trim())}>
        查找
      </Button>
      {ids.length > 0 && (
        <div className="travel-fields">
          {ids.map((id, i) => {
            const item = selected[i]
            return (
              <div className="travel-selected" key={id}>
                {item.data && <GarmentImage src={item.data.image_url} alt="" retry={false} />}
                <span>
                  <strong>
                    {item.data?.name || (item.isPending ? '正在读取单品…' : '未命名单品')}
                  </strong>
                  <small>
                    {item.error
                      ? '无法读取，可重试或移除。'
                      : item.isPending
                        ? '正在核对当前状态'
                        : item.data?.availability !== 'available' ||
                            item.data?.ownership !== 'owned'
                          ? '当前不可用，请核对。'
                          : '至少安排一天'}
                  </small>
                  {item.error && (
                    <Button type="button" variant="outline" onClick={() => void item.refetch()}>
                      重新读取
                    </Button>
                  )}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  aria-label={`移除必带 ${item.data?.name || `单品 ${i + 1}`}`}
                  onClick={() => onChange(ids.filter((g) => g !== id))}
                >
                  移除
                </Button>
              </div>
            )
          })}
        </div>
      )}
      {ids.length >= 20 && <p role="status">已选满 20 件，移除后可继续选。</p>}
      {query.isPending && <p role="status">正在读取衣橱…</p>}
      {query.error && (
        <p role="alert">
          读取失败。
          <Button type="button" onClick={() => void query.refetch()}>
            重试衣橱
          </Button>
        </p>
      )}
      <div className="travel-picker">
        {query.data?.pages
          .flatMap((p) => p.items)
          .filter((g) => !g.is_demo)
          .map((g) => (
            <label key={g.id} className="travel-pick">
              <input
                type="checkbox"
                checked={ids.includes(g.id)}
                disabled={!ids.includes(g.id) && ids.length >= 20}
                onChange={() =>
                  onChange(ids.includes(g.id) ? ids.filter((id) => id !== g.id) : [...ids, g.id])
                }
              />
              <GarmentImage src={g.image_url} alt="" retry={false} />
              <span>{g.name || '未命名单品'}</span>
            </label>
          ))}
      </div>
      {query.data?.pages.every((p) => p.items.length === 0) && <p>没有找到可用单品。</p>}
      {query.hasNextPage && (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          更多衣服
        </Button>
      )}
    </details>
  )
}
