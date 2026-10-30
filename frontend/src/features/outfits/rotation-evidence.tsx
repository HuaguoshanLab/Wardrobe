import { Link } from 'react-router'
import { z } from 'zod'
import type { Revision } from './api'
import './rotation-evidence.css'

const evidenceSchema = z.object({
  mode: z.enum(['avoid_recent', 'less_worn']),
  as_of: z.iso.date(),
  start: z.iso.date(),
  record_count: z.number().int().nonnegative(),
  record_days: z.number().int().nonnegative(),
  full_repeat: z.boolean().optional(),
  body_repeat: z.boolean().optional(),
  message: z.string(),
  items: z.array(
    z.object({
      garment_id: z.string(),
      name: z.string(),
      wear_days: z.number().int().min(0).max(30),
    }),
  ),
})

export function RotationEvidence({ revision }: { revision: Revision }) {
  const parsed = evidenceSchema.safeParse(revision.request_snapshot.rotation)
  if (!parsed.success) return null
  const data = parsed.data
  const avoid = data.mode === 'avoid_recent'
  const empty = data.record_count === 0
  const repeated = avoid && !empty && (data.full_repeat || data.body_repeat)
  const title = empty
    ? '暂无近期穿着记录'
    : !avoid
      ? '参考记录较少的单品'
      : data.full_repeat
        ? '近期穿过这套组合'
        : data.body_repeat
          ? '主体组合近期穿过'
          : data.full_repeat === false && data.body_repeat === false
            ? '近期记录中未见相同组合'
            : '按近期记录比较组合'
  const locks = revision.request_snapshot.locked_garment_ids
  const intent = revision.request_snapshot.intent
  const replacing =
    intent &&
    typeof intent === 'object' &&
    !Array.isArray(intent) &&
    intent.scope === 'replace_items'
  return (
    <section
      className="rotation-evidence"
      aria-label="轮换依据"
      data-state={empty ? 'empty' : repeated ? 'repeat' : 'recorded'}
    >
      <div className="rotation-evidence-heading">
        <span className="rotation-mode-label">{avoid ? '尽量避开近期组合' : '优先近期少穿'}</span>
        <span className="rotation-snapshot-label">生成时的依据</span>
      </div>
      <h3>{title}</h3>
      <p className="rotation-evidence-summary">
        {empty
          ? '本次轮换依据不足，无记录不代表从未穿过。'
          : repeated
            ? '保留可行方案；轮换不保证每次都能避开重复。'
            : avoid
              ? '比较完整组合与主体单品，鞋包可以复用。'
              : '按实际记录天数比较，不推断真实闲置情况。'}
      </p>
      {(replacing || (Array.isArray(locks) && locks.length > 0)) && (
        <p className="rotation-constraints">
          {replacing ? '仅比较替换项，其余单品保持' : '锁定单品优先保持'}
        </p>
      )}
      <div className="rotation-evidence-meta">
        <span>
          近 {avoid ? 7 : 30} 天 · {data.record_days} 天有记录
        </span>
        {empty && <Link to="/collections?view=calendar">查看穿着记录</Link>}
      </div>
      <details key={revision.id} className="rotation-evidence-details">
        <summary>
          <span>
            查看轮换依据{!avoid && data.items.length > 0 ? ` · ${data.items.length} 件单品` : ''}
          </span>
          <span className="rotation-disclosure" aria-hidden="true" />
        </summary>
        <div className="rotation-evidence-content">
          <p className="rotation-evidence-period">
            {data.start} 至 {data.as_of} · 共 {data.record_count} 条实际穿着记录
          </p>
          <p>{data.message}</p>
          {!!data.items.length && (
            <>
              <div className="rotation-list-heading">
                <span>参与比较的单品</span>
                <span>记录天数</span>
              </div>
              <dl>
                {data.items.map((item) => (
                  <div key={item.garment_id}>
                    <dt>{item.name}</dt>
                    <dd>{item.wear_days === 0 ? '期间无记录' : `${item.wear_days} 天`}</dd>
                  </div>
                ))}
              </dl>
            </>
          )}
          <p className="rotation-evidence-footnote">
            这是生成时保存的依据。补记或删除记录后，下次生成才使用新统计。
          </p>
        </div>
      </details>
    </section>
  )
}
