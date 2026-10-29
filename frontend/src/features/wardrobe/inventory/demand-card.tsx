import './demand-card.css'
import { Link } from 'react-router'
import { ArrowUpRight, Check, CircleHelp, Pencil, Pause, SlidersHorizontal } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { conclusionLabel, targetLabel, type Count, type Demand, type Season } from './api'
import type { Bucket } from './members'

export function DemandCard({
  row,
  count,
  category,
  season,
  onOpen,
}: {
  row: Demand
  count: Count
  category: string
  season: Season
  onOpen: (bucket: Bucket) => void
}) {
  const Icon = !row.enabled
    ? Pause
    : count.conclusion === 'enough'
      ? Check
      : count.conclusion === 'review'
        ? CircleHelp
        : SlidersHorizontal
  const invalid = count.rule_errors.length > 0
  return (
    <article className={`inventory-row ${!row.enabled ? 'is-disabled' : ''}`}>
      <header>
        <div className="inventory-row-title">
          <span className="inventory-category">{category}</span>
          <h2>{row.name}</h2>
        </div>
        <Link
          className="inventory-icon-link"
          aria-label={`修改${row.name}目标`}
          to={`/wardrobe/inventory/${season}/edit?row=${row.id}`}
        >
          <Pencil size={18} aria-hidden="true" />
        </Link>
      </header>
      <div className="inventory-target-line">
        <span>我的目标</span>
        <strong>{targetLabel(row)}</strong>
        <span className="inventory-rule-count">
          {row.subtype_ids.length + row.occasion_codes.length + row.tag_ids.length
            ? '含自定匹配规则'
            : '按大类与季节核对'}
        </span>
      </div>
      <p className={`inventory-conclusion is-${count.conclusion}`}>
        <Icon size={17} aria-hidden="true" />
        {conclusionLabel(count)}
      </p>
      {count.conclusion === 'shortage' && (
        <p className="inventory-row-hint">
          已计划 {count.planned} 件，尚未计入库存；共享计划不可跨行累加。
        </p>
      )}
      {invalid ? (
        <p className="error">{count.rule_errors.join('；')}</p>
      ) : (
        <>
          <div className="inventory-counts" aria-label={`${row.name}数量`}>
            <div>
              <span>匹配持有</span>
              <strong>{count.matched_owned}</strong>
            </div>
            <Button
              variant="outline"
              onClick={() => onOpen('confirmed')}
              aria-label={`查看${row.name}已确认 ${count.confirmed} 件`}
            >
              <span>
                确认有效 <ArrowUpRight size={14} aria-hidden="true" />
              </span>
              <strong>{count.confirmed}</strong>
            </Button>
            <Button
              variant="outline"
              className={count.pending ? 'has-pending' : ''}
              onClick={() => onOpen('pending')}
              aria-label={`核对${row.name}待核对 ${count.pending} 件`}
            >
              <span>
                待核对 <ArrowUpRight size={14} aria-hidden="true" />
              </span>
              <strong>{count.pending}</strong>
            </Button>
          </div>
          <p className="inventory-row-hint">
            有效中可穿 {count.available} · 匹配中暂不可用 {count.unavailable}
            {count.needs_attention > 0 && ` · 需维修/处理 ${count.needs_attention}`}
          </p>
          {count.shared > 0 && (
            <p className="inventory-shared">
              {count.shared} 件同时覆盖其他需求，查看明细了解共享情况。
            </p>
          )}
          {count.conclusion === 'shortage' && (
            <p className="inventory-row-hint">先核对未录入的衣服、维修或改衣，以及跨用途替代。</p>
          )}
          {count.pending > 0 && count.conclusion === 'enough' && (
            <p className="inventory-row-hint">待核对完成后，数量和结论可能变化。</p>
          )}
        </>
      )}
      {row.notes && <p className="inventory-row-note">{row.notes}</p>}
      <footer>
        <Button
          variant="outline"
          disabled={invalid}
          onClick={() => onOpen(count.pending ? 'pending' : 'confirmed')}
        >
          查看单品明细 <ArrowUpRight size={16} aria-hidden="true" />
        </Button>
        <Link className="text-link" to={`/wardrobe/inventory/${season}/edit?row=${row.id}`}>
          {invalid ? '修复规则' : '修改目标'}
        </Link>
      </footer>
    </article>
  )
}
