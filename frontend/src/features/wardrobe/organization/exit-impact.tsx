import type { ExitImpact } from './api'
import { seasonLabel } from './api'
export function ExitImpactView({ impact }: { impact: ExitImpact }) {
  const seasons = new Set(impact.rows.map((r) => r.source.season)).size
  const belowTarget = impact.rows.filter(
    (r) => r.lower !== null && r.after_confirmed < r.lower,
  ).length
  return (
    <section className="organization-impact">
      <h3>退出后，会影响这些需求</h3>
      {impact.rows.length > 0 && (
        <div className="organization-impact-summary">
          <strong>
            {seasons} 个季节 · {impact.rows.length} 项需求受影响
          </strong>
          <p>
            {belowTarget > 0
              ? `${belowTarget} 项的确认有效数量将低于目标，请逐项核对。`
              : '确认有效数量未低于已设目标，仍需核对下方资料与规则。'}
          </p>
        </div>
      )}
      {!impact.rows.length && <p>当前有效规则没有发现会改变确认或待核对数量的需求。</p>}
      {impact.rows.map((r) => (
        <article key={r.source.id}>
          <span className="organization-badge">{seasonLabel(r.source.season)}季</span>
          <h4>{r.source.name}</h4>
          <div className="organization-facts">
            <div>
              <span>确认有效</span>
              <strong>
                {r.before_confirmed} → {r.after_confirmed}
                <small> 件</small>
              </strong>
            </div>
            <div>
              <span>待核对</span>
              <strong>
                {r.before_pending} → {r.after_pending}
                <small> 件</small>
              </strong>
            </div>
          </div>
          <p>
            {r.lower === null ? '尚未设目标' : `目标 ${r.lower}–${r.upper} 件`}
            {r.lower !== null && r.after_confirmed < r.lower ? ' · 有效数量将低于目标' : ''}
          </p>
          <p
            className={
              ['shortage', 'review'].includes(r.conclusion) ? 'organization-attention' : ''
            }
          >
            {r.conclusion === 'shortage'
              ? `按已录衣橱至少缺 ${r.difference} 件`
              : r.conclusion === 'review'
                ? '需先核对，不能确定购买缺口'
                : r.conclusion === 'enough'
                  ? '已确认数量仍达标'
                  : r.conclusion === 'excess'
                    ? `仍超过目标 ${r.difference} 件`
                    : '仅展示事实数量'}
          </p>
        </article>
      ))}
      {impact.invalid_sources.length > 0 && (
        <p role="alert" className="organization-attention">
          以下需求规则失效，无法判断影响：
          {impact.invalid_sources.map((s) => `${seasonLabel(s.season)}季 · ${s.name}`).join('、')}
          。可先回盘点修复，再决定。
        </p>
      )}
      <p className="muted">
        以上按已录衣橱计算，不代表这件衣服没有其他用途。确认时会再次核对全部季节；依据变化需重新确认。
      </p>
    </section>
  )
}
