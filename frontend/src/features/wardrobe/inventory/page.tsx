import { useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ClipboardList, Settings2, RefreshCw, Shirt, ChevronRight } from 'lucide-react'
import { PageHeader } from '../../../components/ui/page-header'
import { Button } from '../../../components/ui/button'
import { Sheet } from '../../../components/ui/sheet'
import { getTaxonomy } from '../api'
import { getInventory, seasons, seasonSchema, type Count } from './api'
import { InventoryMembers, type Bucket } from './members'
import { DemandCard } from './demand-card'
import './inventory.css'

const views = {
  all: '全部',
  review: '待核对',
  adjust: '需调整',
  unset: '未设目标',
  disabled: '已停用',
} as const
type View = keyof typeof views
function includes(view: View, count: Count, enabled: boolean) {
  if (view === 'all') return true
  if (view === 'disabled') return !enabled
  if (!enabled) return false
  if (view === 'review') return count.pending > 0 || count.conclusion === 'invalid'
  if (view === 'adjust') return ['shortage', 'excess'].includes(count.conclusion)
  return count.conclusion === 'unset'
}
export function InventoryPage() {
  const [params, setParams] = useSearchParams()
  const season = seasonSchema.catch('spring').parse(params.get('season') ?? 'spring')
  const view = (params.get('view') ?? 'all') as View
  const activeView = Object.hasOwn(views, view) ? view : 'all'
  const query = useQuery({ queryKey: ['inventory', season], queryFn: () => getInventory(season) })
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const [selected, setSelected] = useState<string | null>(params.get('focus'))
  const [bucket, setBucket] = useState<Bucket>(
    params.get('group') === 'pending'
      ? 'pending'
      : params.get('group') === 'excluded'
        ? 'excluded'
        : 'confirmed',
  )
  const focus = useRef<HTMLElement | null>(null)
  const current = query.data
  const count = current?.counts.find((c) => c.row_id === selected)
  const row = current?.plan.rows.find((r) => r.id === selected)
  const entries =
    current?.plan.rows.map((row) => ({
      row,
      count: current.counts.find((c) => c.row_id === row.id)!,
    })) ?? []
  const shown = entries.filter(({ row, count }) => includes(activeView, count, row.enabled))
  const returnTo = `/wardrobe/inventory?season=${season}&view=${activeView}`
  return (
    <section className="inventory-page">
      <PageHeader title="四季盘点" backTo="/wardrobe" backLabel="返回衣橱" />
      <nav className="inventory-seasons" aria-label="选择盘点季节">
        {Object.entries(seasons).map(([key, name]) => (
          <Button
            key={key}
            variant="outline"
            aria-current={season === key ? 'page' : undefined}
            onClick={() => {
              setSelected(null)
              setParams({ season: key })
            }}
          >
            {name}
            <span>季</span>
          </Button>
        ))}
      </nav>
      <div className="inventory-heading">
        <div>
          <span className="eyebrow">SEASONAL WARDROBE</span>
          <h2>{seasons[season]}季，有多少刚刚好</h2>
          <p>按你的生活设目标，按真实衣服核对。</p>
        </div>
        <Link className="button button-primary" to={`/wardrobe/inventory/${season}/edit`}>
          <Settings2 size={17} aria-hidden="true" />
          编辑本季目标
        </Link>
      </div>
      {query.isPending && (
        <p role="status" className="inventory-empty">
          正在核对完整衣橱…
        </p>
      )}
      {query.error && (
        <div role="alert" className="inventory-error">
          <p>{query.error.message}</p>
          <Button onClick={() => void query.refetch()}>重试盘点</Button>
        </div>
      )}
      {current && (
        <>
          <div className="inventory-overview">
            <span>
              <Shirt size={18} aria-hidden="true" />
              <strong>{current.total_owned}</strong>
              <span>件真实持有 · 全衣橱去重</span>
            </span>
            <Link to={`/wardrobe/inventory/subtypes?season=${season}`}>
              管理子类 <ChevronRight size={16} aria-hidden="true" />
            </Link>
          </div>
          {!entries.length ? (
            <section className="inventory-empty">
              <span className="inventory-empty-icon">
                <ClipboardList size={28} aria-hidden="true" />
              </span>
              <h2>先写下这一季的需要</h2>
              <p>从“日常上装”开始。目标数量可以留空，之后再慢慢核对。</p>
              <Link className="button button-primary" to={`/wardrobe/inventory/${season}/edit`}>
                添加第一条需求
              </Link>
              <Link className="text-link" to={`/wardrobe/inventory/${season}/edit?copy=1`}>
                从其他季节复制
              </Link>
            </section>
          ) : (
            <>
              <div className="inventory-view-filters" role="group" aria-label="筛选需求">
                {(Object.entries(views) as [View, string][]).map(([key, name]) => (
                  <Button
                    key={key}
                    variant="outline"
                    aria-pressed={activeView === key}
                    onClick={() => setParams({ season, view: key })}
                  >
                    {name}
                    <span>
                      {entries.filter(({ row, count }) => includes(key, count, row.enabled)).length}
                    </span>
                  </Button>
                ))}
              </div>
              <p className="inventory-list-caption" role="status">
                {seasons[season]}季 · {views[activeView]} {shown.length} 条需求
                <span>各行数量与缺口不可相加</span>
              </p>
              <div className="inventory-rows">
                {shown.map(({ row, count }) => (
                  <DemandCard
                    key={row.id}
                    row={row}
                    count={count}
                    category={taxonomy.data?.fields.category[row.category] ?? row.category}
                    season={season}
                    onOpen={(group) => {
                      focus.current = document.activeElement as HTMLElement
                      setBucket(group)
                      setSelected(row.id)
                    }}
                  />
                ))}
              </div>
              {!shown.length && (
                <div className="inventory-empty">
                  <h3>这一组没有需求</h3>
                  <p>可切换其他分组，或继续完善本季目标。</p>
                  <Button variant="outline" onClick={() => setParams({ season })}>
                    查看全部需求
                  </Button>
                </div>
              )}
            </>
          )}
          {(current.plan.city || current.plan.period || current.plan.notes) && (
            <details className="inventory-context">
              <summary>本季生活背景{current.plan.city && ` · ${current.plan.city}`}</summary>
              <p>
                {[current.plan.period, current.plan.notes].filter(Boolean).join(' · ') ||
                  '尚未填写季节时段与收纳偏好。'}
              </p>
            </details>
          )}
          <Link className="button button-outline" to="/wardrobe/organization">
            查看补充与处理清单
          </Link>
          <div className="inventory-sync">
            <span>
              核对于{' '}
              {new Date(current.stats_at).toLocaleTimeString('zh-CN', {
                hour: '2-digit',
                minute: '2-digit',
              })}
              {query.isFetching ? ' · 正在更新' : ''}
            </span>
            <Button
              variant="outline"
              disabled={query.isFetching}
              onClick={() => void query.refetch()}
            >
              <RefreshCw size={16} aria-hidden="true" />
              重新核对数量
            </Button>
          </div>
          <details className="inventory-method">
            <summary>这些数字如何计算？</summary>
            <p>
              确认有效：匹配此行规则，且状况为完好/轻微磨损、合身或已确认不适用合身检查。属性不足进入待核对；需要维修、不合身或严重损坏不计入有效数量。
            </p>
            <p>
              待洗、收纳、待处理决定仍可计入长期数量。示例、导入草稿、已删除和已退出不计入真实库存。未知目标不同于
              0 件目标。
            </p>
            <p>
              同一件可用于多个季节和用途，不能把各行数量直接相加。分组按需求条数计数，一条需求可以同时属于待核对和需调整。
            </p>
            <p>
              统计于 {new Date(current.stats_at).toLocaleString('zh-CN')} · 本季配置版本{' '}
              {current.plan.version}
            </p>
          </details>
        </>
      )}
      <Sheet
        title={row ? `${row.name} · 单品明细` : '单品明细'}
        open={!!row}
        finalFocus={focus}
        trigger={<button hidden type="button" />}
        onOpenChange={(open) => {
          if (!open) {
            setSelected(null)
            if (params.has('focus')) setParams({ season, view: activeView }, { replace: true })
          }
        }}
      >
        {current && count && row && (
          <InventoryMembers
            key={`${row.id}-${bucket}`}
            data={current}
            count={count}
            initialBucket={bucket}
            returnTo={returnTo}
          />
        )}
      </Sheet>
    </section>
  )
}
