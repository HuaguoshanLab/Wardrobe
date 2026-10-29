import { Link, useSearchParams } from 'react-router'
import { useInfiniteQuery } from '@tanstack/react-query'
import { ArrowUpRight, Plus, ClipboardCheck } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { PageHeader } from '../../../components/ui/page-header'
import { entityId } from '../../../lib/id'
import { getBoard, getSupplies } from './api'
import { SupplyList } from './supply-list'
import { ShortageList } from './shortage-list'
import { DecisionList, decisionFilters } from './decision-list'
import './organization.css'
import './organization-board.css'

export function OrganizationPage() {
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'decisions' ? 'decisions' : 'supply'
  const state = Object.hasOwn(decisionFilters, params.get('state') ?? '')
    ? params.get('state')!
    : 'active'
  const board = useInfiniteQuery({
    queryKey: ['organization', state],
    initialPageParam: '',
    queryFn: ({ pageParam }) => getBoard(state, pageParam),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const plans = useInfiniteQuery({
    queryKey: ['supply-plans'],
    initialPageParam: '',
    queryFn: ({ pageParam }) => getSupplies(pageParam),
    getNextPageParam: (last) => last.next_cursor ?? undefined,
  })
  const items = plans.data?.pages.flatMap((p) => p.items) ?? []
  return (
    <section className="organization-page">
      <PageHeader title="补充与处理" backTo="/wardrobe" backLabel="返回衣橱" />
      <div className="organization-intro">
        <p>把需要的补齐，让留下的更合适。</p>
        <Link className="text-link" to="/wardrobe/inventory">
          四季盘点 <ArrowUpRight size={16} aria-hidden="true" />
        </Link>
      </div>
      <nav className="organization-tabs" aria-label="整理清单">
        <Button
          variant="outline"
          aria-pressed={tab === 'supply'}
          onClick={() => setParams({ tab: 'supply', state })}
        >
          补充计划
        </Button>
        <Button
          variant="outline"
          aria-pressed={tab === 'decisions'}
          onClick={() => setParams({ tab: 'decisions', state })}
        >
          观察与处理
        </Button>
      </nav>
      {board.error && (
        <p role="alert">
          {board.error.message}
          <Button onClick={() => void board.refetch()}>重试读取建议</Button>
        </p>
      )}
      {board.isPending && <p role="status">正在核对衣橱与目标…</p>}
      {tab === 'supply' ? (
        <>
          {board.data && <ShortageList items={board.data.pages[0].shortages} />}
          <div className="organization-section">
            <div>
              <h2>我的补充计划</h2>
              <p className="organization-help">正式入库并关联后，才计入完成进度。</p>
            </div>
            <Link
              className="button button-primary"
              to={`/wardrobe/organization/plans/${entityId()}/edit?new=1`}
            >
              <Plus size={16} aria-hidden="true" />
              手工添加
            </Link>
          </div>
          {plans.error && (
            <p role="alert">
              {plans.error.message}
              <Button onClick={() => void plans.refetch()}>重试计划</Button>
            </p>
          )}
          {plans.isPending && <p role="status">正在读取计划…</p>}
          {plans.data && !items.length && (
            <div className="organization-empty">
              <ClipboardCheck size={28} aria-hidden="true" />
              <h3>还没有补充计划</h3>
              <p>展开上方缺口核对，或记下自己的实际需要。跨季共用的衣服只需建一次计划。</p>
            </div>
          )}
          <SupplyList items={items} hasMore={plans.hasNextPage} />
          {plans.hasNextPage && (
            <Button disabled={plans.isFetchingNextPage} onClick={() => void plans.fetchNextPage()}>
              {plans.isFetchingNextPage ? '正在加载…' : '加载更多计划'}
            </Button>
          )}
        </>
      ) : (
        <>
          <DecisionList
            items={board.data?.pages.flatMap((p) => p.candidates) ?? []}
            state={state}
            ready={!!board.data}
            onState={(state) => setParams({ tab: 'decisions', state })}
          />
          {board.hasNextPage && (
            <Button disabled={board.isFetchingNextPage} onClick={() => void board.fetchNextPage()}>
              {board.isFetchingNextPage ? '正在加载…' : '加载更多整理项'}
            </Button>
          )}
        </>
      )}
    </section>
  )
}
