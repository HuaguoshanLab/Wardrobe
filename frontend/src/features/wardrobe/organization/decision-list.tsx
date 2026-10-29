import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { ClipboardCheck, Shirt } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { decisionLabels, type Candidate } from './api'

export const decisionFilters = {
  active: '待评估与跟进',
  observe: '待观察',
  pending: '待处理',
  keep: '已保留',
  repair: '维修中',
  done: '已处理',
  all: '全部记录',
}
export function DecisionList({
  items,
  state,
  ready,
  onState,
}: {
  items: Candidate[]
  state: string
  ready: boolean
  onState: (state: string) => void
}) {
  const filters = useRef<HTMLDivElement>(null)
  useEffect(() => {
    filters.current
      ?.querySelector('[aria-pressed="true"]')
      ?.scrollIntoView?.({ block: 'nearest', inline: 'center' })
  }, [state])
  return (
    <>
      <div className="organization-filters" ref={filters} role="group" aria-label="筛选整理决定">
        {Object.entries(decisionFilters).map(([key, name]) => (
          <Button
            key={key}
            variant="outline"
            aria-pressed={state === key}
            onClick={() => onState(key)}
          >
            {name}
          </Button>
        ))}
      </div>
      <p className="organization-help">
        一件衣服可能有多个整理原因。保留决定按原因记录，不会因新建议被覆盖。
      </p>
      {ready && !items.length && (
        <div className="organization-empty">
          <ClipboardCheck size={28} aria-hidden="true" />
          <h3>这一组暂无整理事项</h3>
          <p>无需为了整理而丢弃。你也可以从单品详情主动记录决定。</p>
        </div>
      )}
      {items.map((c) => (
        <article
          className="organization-card organization-decision-card"
          key={`${c.garment_id}:${c.reason_key}`}
        >
          <div className="organization-item">
            <div className="organization-thumbnail">
              <Shirt size={26} aria-hidden="true" />
              {c.image_url && (
                <img
                  src={c.image_url}
                  alt=""
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.visibility = 'hidden'
                  }}
                />
              )}
            </div>
            <div>
              <span className="organization-badge" data-state={c.state}>
                {decisionLabels[c.state]}
              </span>
              <h3>{c.name}</h3>
            </div>
          </div>
          <div className="organization-evidence">
            <span className="organization-kicker">
              {c.reason_key === 'manual' ? '主动整理' : '核对依据'}
            </span>
            <p>{c.reason}</p>
          </div>
          {c.note && (
            <blockquote>
              <span>你的决定说明</span>
              <p>{c.note}</p>
            </blockquote>
          )}
          {!c.current && c.reason_key !== 'manual' && (
            <p className="muted">原建议依据已变化，已有决定保留供你复核。</p>
          )}
          <div className="organization-actions">
            <Link
              className="text-link"
              to={`/wardrobe/${c.garment_id}`}
              state={{ organizationReturn: `/wardrobe/organization?tab=decisions&state=${state}` }}
            >
              查看单品
            </Link>
            {!c.archived ? (
              <Link
                className="button button-outline"
                to={`/wardrobe/organization/garments/${c.garment_id}?${new URLSearchParams({ reason: c.reason_key, state })}`}
              >
                {c.state === 'keep' ? '复核保留决定' : '记录决定 / 处理'}
              </Link>
            ) : (
              <span className="muted">已归档，处理记录保留</span>
            )}
          </div>
        </article>
      ))}
    </>
  )
}
