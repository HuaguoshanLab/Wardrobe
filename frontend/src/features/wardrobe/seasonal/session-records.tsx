import { ArrowRight, CheckCircle2, Clock3 } from 'lucide-react'
import { Link } from 'react-router'
import type { getSessions } from './api'
import { stages } from './api'
import { seasons } from '../inventory/api'
type Brief = Awaited<ReturnType<typeof getSessions>>['items'][number]
export function SessionRecords({
  items,
  more,
  categories,
}: {
  items: Brief[]
  more: boolean
  categories: Record<string, string>
}) {
  const active = items.filter((s) => !s.completed_at)
  const complete = items.filter((s) => s.completed_at)
  const rows = (values: Brief[]) => (
    <div className="seasonal-records">
      {values.map((s) => (
        <Link
          className={`seasonal-record ${s.completed_at ? 'is-complete' : ''}`}
          key={s.id}
          to={`/wardrobe/seasonal/${s.id}`}
        >
          <span className="seasonal-record-icon">
            {s.completed_at ? (
              <CheckCircle2 size={22} aria-hidden="true" />
            ) : (
              <Clock3 size={22} aria-hidden="true" />
            )}
          </span>
          <div>
            <h3>
              {seasons[s.season]}季整理{' '}
              <small>{s.completed_at ? '总结已保存' : stages[s.stage]}</small>
            </h3>
            <p>
              {s.categories.length
                ? s.categories.map((c) => categories[c] ?? c).join('、')
                : '全部品类'}{' '}
              · {s.scope === 'all' ? '全部持有' : '本季与季节未知'}
            </p>
            <small>{new Date(s.created_at).toLocaleDateString('zh-CN')}</small>
          </div>
          <span>
            {s.completed_at ? '查看总结' : '继续整理'}
            <ArrowRight size={16} aria-hidden="true" />
          </span>
        </Link>
      ))}
    </div>
  )
  return (
    <>
      <div className="seasonal-section-heading">
        <h2>继续未完成的整理</h2>
        <span className="muted">
          {more ? '已加载 ' : ''}
          {active.length} 轮
        </span>
      </div>
      {active.length ? (
        rows(active)
      ) : (
        <p className="seasonal-empty">
          {more
            ? '已加载记录中没有进行中的整理，可加载更多。'
            : '没有进行中的整理。选择季节与范围，开始新一轮。'}
        </p>
      )}
      {complete.length > 0 && (
        <details className="seasonal-history">
          <summary>
            历史总结 · {more ? '已加载 ' : ''}
            {complete.length} 轮
          </summary>
          {rows(complete)}
        </details>
      )}
    </>
  )
}
