import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router'
import { Button } from '../../../components/ui/button'
import { PageHeader } from '../../../components/ui/page-header'
import { getTaxonomy } from '../api'
import { getUsage } from './api'
import { UsageCard } from './item'
import { UsageOverview } from './overview'
import './usage.css'

const ranges = { '30': '近 30 天', '90': '近 90 天', all: '全部记录' }
export function UsagePage() {
  const [params, setParams] = useSearchParams()
  const heading = useRef<HTMLHeadingElement>(null)
  const range = ['30', '90', 'all'].includes(params.get('range') ?? '')
    ? params.get('range')!
    : '30'
  const view = params.get('view') === 'unrecorded' ? 'unrecorded' : 'worn'
  const rawOffset = Number(params.get('offset') ?? 0)
  const offset =
    Number.isInteger(rawOffset) && rawOffset >= 0 && rawOffset <= 1000000 ? rawOffset : 0
  const query = useQuery({
    queryKey: ['garments', 'usage', range, view, offset],
    queryFn: () => getUsage(range, view, offset),
  })
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const data = query.isError ? undefined : query.data
  const returnTo = `/wardrobe/usage?${params}`
  function filter(key: string, value: string) {
    const next = new URLSearchParams(params)
    next.set(key, value)
    if (key !== 'offset') next.delete('offset')
    setParams(next)
    if (key === 'offset') {
      heading.current?.focus({ preventScroll: true })
      heading.current?.scrollIntoView({ block: 'start', behavior: 'instant' })
    }
  }
  const listName = view === 'worn' ? '常穿单品' : '期间无记录'
  const pageNumber = data ? Math.floor(offset / data.limit) + 1 : null
  return (
    <div className="subpage usage-page">
      <PageHeader title="衣橱利用情况" backTo="/wardrobe" backLabel="返回衣橱" />
      <div className="usage-ranges" role="group" aria-label="统计时间范围">
        {Object.entries(ranges).map(([value, label]) => (
          <Button
            key={value}
            variant="outline"
            aria-pressed={range === value}
            onClick={() => filter('range', value)}
          >
            {label}
          </Button>
        ))}
      </div>
      <UsageOverview
        loading={query.isPending || query.isFetching}
        data={data}
        view={view}
        onView={(value) => filter('view', value)}
      />
      <section
        id="usage-results"
        className="usage-results"
        aria-labelledby="usage-list-title"
        aria-busy={query.isFetching}
      >
        <div className="usage-list-heading">
          <h2 id="usage-list-title" ref={heading} tabIndex={-1}>
            {listName}
          </h2>
          <span>{view === 'worn' ? '记录天数从多到少' : '最近入库在前'}</span>
        </div>
        <p className="usage-result-status" role="status" aria-atomic="true">
          {query.isPending
            ? '正在读取所选范围…'
            : query.isFetching
              ? '正在更新统计…'
              : data
                ? `${listName}共 ${data.total_items} 件${data.items.length ? `，显示第 ${offset + 1}–${offset + data.items.length} 件` : ''}`
                : '读取失败，筛选条件已保留'}
        </p>
        {query.isPending && (
          <div className="usage-loading" aria-hidden="true">
            <span />
            <span />
          </div>
        )}
        {query.isError && (
          <div role="alert" className="panel usage-empty">
            <h3>暂时无法读取利用情况</h3>
            <p>{query.error.message}</p>
            <Button variant="outline" onClick={() => void query.refetch()}>
              重新读取利用情况
            </Button>
          </div>
        )}
        {data &&
          (!data.total_garments ? (
            <section className="panel usage-empty">
              <h3>先把衣服放进衣橱</h3>
              <p>当前没有可统计的正式衣服，录入后即可查看。</p>
              <Link className="button button-primary" to="/imports">
                录入衣服
              </Link>
            </section>
          ) : !data.items.length ? (
            <div className="panel usage-empty">
              <h3>
                {offset
                  ? '这一页暂无单品'
                  : view === 'worn'
                    ? '这段时间还没有穿着记录'
                    : '每件衣服都有期间记录'}
              </h3>
              <p>
                {offset
                  ? '记录已变化，可以回到第一页。'
                  : '只反映已记录的穿着，不推断实际使用情况。'}
              </p>
              {offset > 0 ? (
                <Button onClick={() => filter('offset', '0')}>回到第一页</Button>
              ) : view === 'worn' ? (
                <div className="actions">
                  <Link className="button button-outline" to="/collections?view=calendar">
                    去记录实际穿着
                  </Link>
                  <Button variant="outline" onClick={() => filter('view', 'unrecorded')}>
                    看看无记录单品
                  </Button>
                </div>
              ) : null}
            </div>
          ) : (
            <div className="usage-items">
              {data.items.map((item) => (
                <UsageCard
                  key={item.garment_id}
                  item={item}
                  returnTo={returnTo}
                  category={taxonomy.data?.fields.category[item.category ?? '']}
                />
              ))}
            </div>
          ))}
        {data && (offset > 0 || data.next_offset !== null) && (
          <nav className="usage-pagination" aria-label="利用情况分页">
            <Button
              variant="outline"
              disabled={offset === 0 || query.isFetching}
              onClick={() => filter('offset', String(Math.max(0, offset - data.limit)))}
            >
              上一页
            </Button>
            <span>
              第 {pageNumber} / {Math.max(1, Math.ceil(data.total_items / data.limit))} 页
            </span>
            <Button
              variant="outline"
              disabled={data.next_offset === null || query.isFetching}
              onClick={() => filter('offset', String(data.next_offset))}
            >
              下一页
            </Button>
          </nav>
        )}
      </section>
    </div>
  )
}
