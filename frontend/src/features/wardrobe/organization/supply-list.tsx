import { Link } from 'react-router'
import { ArrowUpRight } from 'lucide-react'
import { supplyLabels, seasonLabel, type Supply } from './api'
import { SupplyProgress } from './supply-progress'

function PlanCard({ plan: p }: { plan: Supply }) {
  return (
    <Link className="organization-card supply-link" to={`/wardrobe/organization/plans/${p.id}`}>
      <div className="organization-section">
        <span className="organization-badge" data-state={p.status}>
          {supplyLabels[p.status]}
        </span>
        <ArrowUpRight size={18} aria-hidden="true" />
      </div>
      <h3>{p.name}</h3>
      <SupplyProgress plan={p} />
      <small>
        {p.sources.length
          ? `${[...new Set(p.sources.map((s) => `${seasonLabel(s.season)}季`))].join(' · ')} · ${p.sources.length} 项关联需求`
          : '手工计划 · 按自己的需要补充'}
      </small>
    </Link>
  )
}
export function SupplyList({ items, hasMore }: { items: Supply[]; hasMore: boolean }) {
  const active = items.filter((p) => p.remaining > 0)
  const closed = items.filter((p) => p.remaining === 0)
  return (
    <>
      {hasMore && <p className="muted">已加载 {items.length} 项计划；下方可继续加载。</p>}
      <div className="organization-plan-grid">
        {active.map((p) => (
          <PlanCard key={p.id} plan={p} />
        ))}
      </div>
      {!active.length && items.length > 0 && (
        <p className="notice">已加载的计划均已结束。需要添置时，随时新增一项。</p>
      )}
      {closed.length > 0 && (
        <details className="organization-disclosure">
          <summary>
            已结束的计划 · {closed.length} 项{hasMore ? '（已加载）' : ''}
          </summary>
          <p className="muted">已完成和暂不需要的计划保留在这里，仍可查看或编辑。</p>
          <div className="organization-plan-grid">
            {closed.map((p) => (
              <PlanCard key={p.id} plan={p} />
            ))}
          </div>
        </details>
      )}
    </>
  )
}
