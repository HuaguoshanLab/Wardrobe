import { Link, useLocation } from 'react-router'
import { Button } from '../../../components/ui/button'
import type { OperationController } from '../../../lib/use-operation'
import { conclusionLabel, seasons, targetLabel } from '../inventory/api'
import type { Seasonal } from './api'
import { ActionHistory } from './action-history'

export function InventoryFacts({ session }: { session: Seasonal }) {
  const inv = session.summary?.inventory ?? session.inventory
  return (
    <div className="seasonal-facts">
      {!inv.plan.rows.length && (
        <p className="seasonal-empty">
          {session.completed_at
            ? '完成时未设置本季目标，未计算目标缺口。'
            : '还没有本季需求目标。可以先编辑，也可以明确确认暂不设置目标。'}
        </p>
      )}
      {inv.plan.rows.map((row) => {
        const count = inv.counts.find((c) => c.row_id === row.id)!
        return (
          <article key={row.id}>
            <div>
              <h3>{row.name}</h3>
              <p>{targetLabel(row)}</p>
            </div>
            <div>
              <strong>
                {count.confirmed} <small>确认有效</small> / {count.pending} <small>待核对</small>
              </strong>
              <p>{conclusionLabel(count)}</p>
              {count.planned > 0 && <p>已计划补充 {count.planned} 件，尚未计入库存</p>}
              {count.rule_errors.map((e) => (
                <p key={e} className="seasonal-attention">
                  {e}
                </p>
              ))}
            </div>
          </article>
        )
      })}
    </div>
  )
}
export function Targets({
  session,
  operation,
}: {
  session: Seasonal
  operation: OperationController
}) {
  const location = useLocation()
  return (
    <section className="seasonal-section">
      <div className="seasonal-section-heading">
        <div>
          <h2>{seasons[session.season]}季，需要多少件才够</h2>
          <p>使用你自己的目标。共享单品按需求覆盖，未知资料不算已确认有效。</p>
        </div>
        <Link
          className="text-link"
          state={{ seasonalReturn: location.pathname + location.search }}
          to={`/wardrobe/inventory/${session.season}/edit`}
        >
          编辑本季目标
        </Link>
      </div>
      <InventoryFacts session={session} />
      <p className={session.targets_confirmed ? 'muted' : 'seasonal-attention'}>
        {session.targets_confirmed
          ? '已确认当前目标与规则。'
          : '当前目标尚未确认，或规则已变化。请核对后确认。'}
      </p>
      <Button
        disabled={operation.busy || session.targets_confirmed}
        onClick={() =>
          operation.send(`/seasonal-sessions/${session.id}/progress`, 'POST', {
            expected_version: session.version,
            stage: 'targets',
            target_token: session.target_token,
          })
        }
      >
        确认当前目标与规则
      </Button>
      <div className="seasonal-buttons">
        <Link className="text-link" to={`/wardrobe/inventory?season=${session.season}`}>
          查看缺少、超额与共享明细
        </Link>
        <Link className="text-link" to="/wardrobe/organization">
          查看补充与处理清单
        </Link>
      </div>
    </section>
  )
}
export function Summary({
  session,
  operation,
  acknowledged,
  onAcknowledge,
}: {
  session: Seasonal
  operation: OperationController
  acknowledged: boolean
  onAcknowledge: (v: boolean) => void
}) {
  const summary = session.summary ?? session.preview
  const stale = session.items.filter((i) => i.stale).length
  return (
    <section className="seasonal-section">
      <h2>{session.completed_at ? '本轮总结已保存' : '最后看看这一轮的结果'}</h2>
      <p>
        {session.completed_at
          ? '这是完成时保存的记录，衣橱后续变化不会修改这份总结。'
          : '只保存总结，不会再次执行收纳、维修、退出或购入。'}
      </p>
      <div className="seasonal-metrics">
        <div>
          <strong>
            {summary.reviewed}/{summary.total}
          </strong>
          <span>已核对覆盖</span>
        </div>
        <div>
          <strong>{summary.actions.filter((a) => a.success).length}</strong>
          <span>已执行动作</span>
        </div>
        <div>
          <strong>{summary.unresolved.length}</strong>
          <span>未解决项</span>
        </div>
      </div>
      <p className="muted">
        统计于 {new Date(summary.stats_at).toLocaleString('zh-CN')} · 本季目标版本{' '}
        {summary.inventory.plan.version}
      </p>
      <h3>{session.completed_at ? '当时的数量与缺口' : '当前数量与缺口'}</h3>
      <InventoryFacts session={session} />
      {summary.unresolved.length > 0 && (
        <div className="seasonal-confirm">
          <h3>留待下次处理</h3>
          <ul>
            {summary.unresolved.slice(0, 5).map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ul>
          {summary.unresolved.length > 5 && (
            <details>
              <summary>展开其余 {summary.unresolved.length - 5} 项</summary>
              <ul>
                {summary.unresolved.slice(5).map((text, i) => (
                  <li key={i}>{text}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      )}
      <details className="seasonal-history">
        <summary>查看核对范围 · {summary.total} 件</summary>
        <div className="seasonal-items">
          {summary.items.map((i) => {
            const g = i.current ?? i.original
            return (
              <article className="seasonal-item" key={i.garment_id}>
                <img src={g.image_url} alt="" loading="lazy" />
                <div>
                  <h3>{g.name ?? '未命名单品'}</h3>
                  <p>
                    {!i.current
                      ? '已删除，保留原始快照'
                      : i.stale
                        ? '核对已过期'
                        : i.reviewed_version
                          ? '已核对'
                          : '尚未核对'}{' '}
                    · {g.ownership === 'retired' ? '已退出' : '仍持有'}
                  </p>
                  {i.todo && <p>{i.todo}</p>}
                </div>
              </article>
            )
          })}
        </div>
      </details>
      <ActionHistory session={session} />
      {session.completed_at ? (
        <Link className="text-link" to="/wardrobe/seasonal">
          再开始一轮整理
        </Link>
      ) : (
        <>
          {(!session.targets_confirmed || stale > 0) && (
            <div role="status" className="seasonal-attention">
              <p>
                {stale > 0 ? `${stale} 件核对已过期，请回到“核对单品”。` : ''}
                {!session.targets_confirmed ? '请先确认当前目标与规则。' : ''}
              </p>
              <div className="seasonal-buttons">
                {stale > 0 && (
                  <Button
                    variant="outline"
                    disabled={operation.busy}
                    onClick={() =>
                      operation.send(`/seasonal-sessions/${session.id}/progress`, 'POST', {
                        expected_version: session.version,
                        stage: 'review',
                      })
                    }
                  >
                    返回核对已变化单品
                  </Button>
                )}
                {!session.targets_confirmed && (
                  <Button
                    variant="outline"
                    disabled={operation.busy}
                    onClick={() =>
                      operation.send(`/seasonal-sessions/${session.id}/progress`, 'POST', {
                        expected_version: session.version,
                        stage: 'targets',
                      })
                    }
                  >
                    返回确认目标
                  </Button>
                )}
              </div>
            </div>
          )}
          <label className="seasonal-check">
            <input
              type="checkbox"
              checked={acknowledged}
              disabled={operation.busy}
              onChange={(e) => onAcknowledge(e.target.checked)}
            />
            我已核对总结，并保留上面列出的未解决项
          </label>
          <Button
            disabled={operation.busy || !acknowledged || !session.targets_confirmed || stale > 0}
            onClick={() =>
              operation.send(`/seasonal-sessions/${session.id}/complete`, 'POST', {
                expected_version: session.version,
                preview_token: session.preview_token,
                acknowledge_unresolved: acknowledged,
              })
            }
          >
            保存本轮总结
          </Button>
        </>
      )}
    </section>
  )
}
