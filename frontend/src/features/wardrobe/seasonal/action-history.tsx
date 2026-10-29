import type { Seasonal } from './api'
import { labels } from '../lifecycle-api'

export function actionLabel(action: Seasonal['actions'][number]['operation']) {
  const value = action.changes
  if (action.action === 'storage') return value.storage === 'stored' ? '换季收纳' : '取回日常'
  if (action.action === 'repair_start') return '开始维修'
  if (action.action === 'decision') return '继续保留'
  if (action.action === 'retire')
    return labels.exit_reason[value.exit_reason as keyof typeof labels.exit_reason] ?? '退出衣橱'
  return '资料更新'
}
export function latestFailed(session: Seasonal) {
  const latest = new Map(session.actions.map((a) => [a.garment_id, a]))
  return new Set([...latest.values()].filter((a) => !a.success).map((a) => a.garment_id))
}
export function ActionHistory({ session }: { session: Seasonal }) {
  const failed = latestFailed(session)
  return (
    <details className="seasonal-history" open={!session.completed_at && failed.size > 0}>
      <summary>
        动作记录 · {session.actions.filter((a) => a.success).length} 项成功 /{' '}
        {session.actions.filter((a) => !a.success).length} 项失败
      </summary>
      {!session.actions.length && <p className="muted">尚未执行动作，保存核对不算实际处理。</p>}
      {[...session.actions].reverse().map((a) => (
        <article className="seasonal-action-record" key={a.id}>
          <span className={`seasonal-status ${a.success ? '' : 'is-attention'}`}>
            {a.success ? '已执行' : '未执行'}
          </span>
          <div>
            <strong>
              {session.items.find((i) => i.garment_id === a.garment_id)?.original.name ??
                '未命名单品'}
            </strong>
            <p>
              {actionLabel(a.operation)} · {a.operation.occurred_on}
            </p>
            {!a.success && <p className="error">{a.message}</p>}
            {a.operation.reason && <p>{a.operation.reason}</p>}
          </div>
        </article>
      ))}
      {session.actions.some((a) => !a.success) && (
        <p className="muted">
          {session.completed_at
            ? '失败回执保留在此。需继续处理时，请开始新一轮。'
            : failed.size
              ? `还有 ${failed.size} 件的最近一次动作未成功。重新核对后，仅选择未成功项；已经成功的动作无需重做。`
              : '此前失败的单品已有后续成功记录，旧回执仍保留。'}
        </p>
      )}
    </details>
  )
}
