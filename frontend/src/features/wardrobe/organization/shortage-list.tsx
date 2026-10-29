import { Link } from 'react-router'
import { entityId } from '../../../lib/id'
import { seasonLabel } from './api'
import type { z } from 'zod'
import type { boardSchema } from './api'

type Shortage = z.infer<typeof boardSchema>['shortages'][number]
export function ShortageList({ items }: { items: Shortage[] }) {
  return (
    <details className="organization-disclosure organization-shortages">
      <summary>查看数量缺口 · {items.length} 项需求</summary>
      <p className="muted">
        先核对未录入、可维修及跨用途替代。共享计划不可跨行相加，已计划仍不算库存。
      </p>
      {!items.length && <p>当前没有明确数量缺口。未设目标或资料不足不会被当成需要购买。</p>}
      <div className="organization-stack">
        {items.map((s) => (
          <article className="organization-card" key={s.source.id}>
            <span className="organization-kicker">{seasonLabel(s.source.season)}季</span>
            <h3>{s.source.name}</h3>
            <div className="organization-facts">
              <div>
                <span>按已录衣橱至少缺</span>
                <strong>
                  {s.difference}
                  <small> 件</small>
                </strong>
              </div>
              <div>
                <span>已纳入补充计划</span>
                <strong>
                  {s.planned}
                  <small> 件</small>
                </strong>
              </div>
            </div>
            {s.planned >= s.difference && (
              <p className="notice">已有计划覆盖当前缺口，请先核对计划进度。</p>
            )}
            {s.needs_attention > 0 && (
              <p className="muted">另有 {s.needs_attention} 件需要维修或处理。</p>
            )}
            <div className="organization-actions">
              <Link
                className="text-link"
                to={`/wardrobe/inventory?${new URLSearchParams({ season: s.source.season, focus: s.source.id })}`}
              >
                核对这项需求
              </Link>
              <Link
                className="button button-outline"
                to={`/wardrobe/organization/plans/${entityId()}/edit?${new URLSearchParams({ new: '1', source: s.source.id, name: s.source.name, quantity: String(Math.max(1, s.difference - s.planned)) })}`}
              >
                {s.planned ? '另建补充计划' : '考虑补充'}
              </Link>
            </div>
          </article>
        ))}
      </div>
    </details>
  )
}
