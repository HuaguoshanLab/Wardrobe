import { Check } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import type { UsageReport } from './api'

export function UsageOverview({
  data,
  view,
  onView,
  loading,
}: {
  loading: boolean
  data?: UsageReport
  view: string
  onView: (view: string) => void
}) {
  return (
    <section className="usage-overview" aria-label="记录覆盖情况">
      <div className="usage-coverage">
        <strong className="usage-ratio">
          {!data || data.recorded_ratio === null
            ? '—'
            : `${Math.round(data.recorded_ratio * 100)}%`}
        </strong>
        <div>
          <span>有穿着记录的单品</span>
          <p>
            {data
              ? `${data.recorded_garments} / ${data.total_garments} 件当前衣服`
              : loading
                ? '正在读取完整统计…'
                : '统计暂不可用'}
          </p>
        </div>
      </div>
      <p className="usage-scope">
        {data
          ? data.window_start
            ? `${data.window_start} 至 ${data.as_of} · 北京时间`
            : `截至 ${data.as_of}，暂无穿着记录`
          : '统计范围以北京时间自然日计算'}
      </p>
      <div className="usage-views" role="group" aria-label="单品记录筛选">
        {[
          { key: 'worn', label: '常穿单品', count: data?.recorded_garments },
          { key: 'unrecorded', label: '期间无记录', count: data?.unrecorded_garments },
        ].map(({ key, label, count }) => (
          <Button
            key={key}
            variant="outline"
            className="usage-view"
            aria-label={`${label} · ${count ?? (loading ? '正在读取' : '未读取')}`}
            aria-pressed={view === key}
            aria-controls="usage-results"
            onClick={() => onView(key)}
          >
            <span className="usage-view-label">{label}</span>
            <span className="usage-view-count">
              {count ?? '—'} <small>件</small>
            </span>
            <Check size={16} className="usage-view-check" aria-hidden="true" />
          </Button>
        ))}
      </div>
      <details className="usage-explainer">
        <summary>无记录不等于没穿过 · 查看统计口径</summary>
        <p>
          只统计当前持有、未删除的正式衣服，暂不可穿也计入；示例和已退出单品不计入。手动与 AI
          搭配的实际穿着合并统计，同一件同一天只算一天。
        </p>
        <p>
          入库日期帮助你识别新衣服；“最近记录”包括所选范围之前的日期。全部记录的起始日为当前衣服最早的已记录穿着日期。
        </p>
      </details>
    </section>
  )
}
