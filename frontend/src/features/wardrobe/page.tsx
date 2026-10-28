import { useLayoutEffect, useRef } from 'react'
import { CategoryRail, WardrobeFilters } from './filters'
import './wardrobe-browser.css'
import { Link, useSearchParams } from 'react-router'
import { keepPreviousData, useInfiniteQuery, useQuery } from '@tanstack/react-query'
import { Shirt, Plus } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { getGarments, getTags, getTaxonomy } from './api'
import { Tags } from './tags'
import { GarmentImage } from './image'
import './wardrobe-controls.css'

export function WardrobePage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = Object.fromEntries(searchParams)
  const listRef = useRef<HTMLDivElement>(null)
  const positionKey = `wardrobe-scroll:${searchParams.toString()}`
  const positions = useRef<Record<string, number>>({})
  useLayoutEffect(() => {
    const element = listRef.current
    if (!element) return
    element.scrollTop = Number(sessionStorage.getItem(positionKey) ?? 0)
    return () => {
      sessionStorage.setItem(
        positionKey,
        String(positions.current[positionKey] ?? element.scrollTop),
      )
    }
  }, [positionKey])
  const activeFilters = ['q', 'category', 'season', 'occasion', 'availability', 'tag_id'].some(
    (key) => !!filters[key],
  )
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  const params = new URLSearchParams({
    ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)),
  })
  params.delete('cursor')
  const query = useInfiniteQuery({
    queryKey: ['garments', 'infinite', params.toString()],
    initialPageParam: '',
    queryFn: ({ pageParam }) => {
      const next = new URLSearchParams(params)
      if (pageParam) next.set('cursor', pageParam)
      return getGarments(next)
    },
    getNextPageParam: (last) => last.next_cursor ?? undefined,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
    gcTime: 30 * 60_000,
  })
  const items = query.data?.pages.flatMap((page) => page.items) ?? []
  useLayoutEffect(() => {
    if (!query.isPlaceholderData && items.length && listRef.current) {
      listRef.current.scrollTop =
        positions.current[positionKey] ?? Number(sessionStorage.getItem(positionKey) ?? 0)
    }
  }, [positionKey, query.isPlaceholderData, items.length])
  const applyFilters = (next: URLSearchParams) => {
    next.delete('cursor')
    sessionStorage.removeItem(`wardrobe-scroll:${next.toString()}`)
    positions.current[`wardrobe-scroll:${next.toString()}`] = 0
    if (listRef.current) listRef.current.scrollTop = 0
    setSearchParams(next, { replace: true })
  }
  const filter = (key: string, value: string) => {
    const next = new URLSearchParams(searchParams)
    if (value) next.set(key, value)
    else next.delete(key)
    applyFilters(next)
  }
  return (
    <section className="wardrobe-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">EVERY PIECE, IN PLACE</span>
          <h1>我的衣橱</h1>
          <p>衣服、鞋和配饰，按你的方式整理。</p>
        </div>
        <div className="wardrobe-heading-actions">
          <Tags />
          <Link className="button button-primary" to="/imports">
            <Plus size={18} aria-hidden="true" />
            录入衣服
          </Link>
        </div>
      </div>
      <WardrobeFilters
        filters={filters}
        fields={taxonomy.data?.fields ?? {}}
        filter={filter}
        tags={tags.data ?? []}
        resetExtra={() => {
          const next = new URLSearchParams(searchParams)
          for (const key of ['occasion', 'availability', 'tag_id', 'cursor']) next.delete(key)
          applyFilters(next)
        }}
      />
      {(taxonomy.error || tags.error) && (
        <p role="alert" className="error">
          筛选选项读取失败。
          <button
            onClick={() => {
              void taxonomy.refetch()
              void tags.refetch()
            }}
          >
            重试筛选选项
          </button>
        </p>
      )}
      <div className="wardrobe-browser">
        <CategoryRail filters={filters} fields={taxonomy.data?.fields ?? {}} filter={filter} />
        <div
          className="wardrobe-results"
          ref={listRef}
          onScroll={(event) => {
            positions.current[positionKey] = event.currentTarget.scrollTop
          }}
          aria-busy={query.isFetching}
          role="region"
          aria-label="衣橱列表"
          tabIndex={0}
        >
          <div className="wardrobe-summary">
            <span role="status">
              {query.isPending
                ? '正在读取衣橱…'
                : query.data
                  ? `${query.isFetching && !query.isFetchingNextPage ? '更新中 · ' : ''}已显示 ${items.length} 件`
                  : ''}
            </span>
            {activeFilters && (
              <Button variant="outline" onClick={() => applyFilters(new URLSearchParams())}>
                清除筛选
              </Button>
            )}
          </div>
          {query.isPending && (
            <div className="garment-grid" aria-hidden="true">
              {Array.from({ length: 8 }, (_, i) => (
                <div className="garment-skeleton" key={i} />
              ))}
            </div>
          )}
          {query.error && (
            <p className="error" role="alert">
              {query.error.message}
              <Button variant="outline" onClick={() => void query.refetch()}>
                重试读取衣橱
              </Button>
            </p>
          )}
          {!query.isPending && !query.error && items.length === 0 && (
            <section className="panel planned">
              <Shirt size={40} />
              <h2>{activeFilters ? '没有找到匹配的单品' : '让第一件衣服住进来'}</h2>
              <p>
                {activeFilters
                  ? '试试其他关键词，或清除筛选查看全部衣服。'
                  : '上传照片或导入 Excel，审核后就会出现在这里。'}
              </p>
              {activeFilters ? (
                <Button variant="outline" onClick={() => applyFilters(new URLSearchParams())}>
                  查看全部衣服
                </Button>
              ) : (
                <Link to="/imports" className="button button-primary">
                  开始录入
                </Link>
              )}
            </section>
          )}
          <div className="garment-grid">
            {items.map((item) => (
              <Link
                to={`/wardrobe/${item.id}`}
                state={{ wardrobeSearch: searchParams.toString() }}
                key={item.id}
                className="garment-card"
              >
                <GarmentImage retry={false} src={item.image_url} alt={item.name ?? '衣服'} />
                <div>
                  <h3>
                    {item.name ||
                      taxonomy.data?.fields.category[item.category ?? ''] ||
                      '未命名单品'}
                  </h3>
                  <p
                    className={`availability ${item.availability === 'available' ? 'available' : 'unavailable'}`}
                  >
                    {item.availability === 'available' ? '可穿' : '暂不可用'}
                    {item.is_demo ? ' · 示例' : ''}
                  </p>
                  <span>
                    {item.seasons.map((s) => taxonomy.data?.fields.seasons[s] ?? s).join(' / ') ||
                      '季节未标注'}
                  </span>
                </div>
              </Link>
            ))}
          </div>
          <div className="wardrobe-load-more">
            {query.hasNextPage && (
              <Button
                variant="outline"
                disabled={query.isFetching}
                onClick={() => void query.fetchNextPage()}
              >
                {query.isFetchingNextPage ? '正在加载…' : '加载更多'}
              </Button>
            )}
            {!query.hasNextPage && items.length > 0 && (
              <span className="muted">已显示全部匹配单品</span>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}

export { GarmentPage } from './detail'
