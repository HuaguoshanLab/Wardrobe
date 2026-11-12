import { CalendarDays, MapPin, Luggage } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { getTaxonomy } from '../wardrobe'
import type { TravelInput } from './api'

export function TravelSummary({ draft }: { draft: TravelInput }) {
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  return (
    <section className="panel travel-brief" aria-label="已保存行程条件">
      <div className="travel-brief-heading">
        <MapPin size={20} aria-hidden="true" />
        <h2>
          {draft.city.name} · {draft.days.length} 天
        </h2>
        <span className="travel-badge">已保存条件</span>
      </div>
      <p className="travel-dates">
        <CalendarDays size={16} aria-hidden="true" />
        {draft.days[0].date} — {draft.days.at(-1)?.date}
      </p>
      <div className="travel-facts">
        <span>
          <Luggage size={18} aria-hidden="true" />
          期望 {draft.target_count} 件
        </span>
        <span>必带 {draft.required_garment_ids.length} 件</span>
        <span>{draft.allow_repeat ? '允许基础衣物重复穿' : '基础衣物不重复穿'}</span>
      </div>
      <details>
        <summary>每日条件与备注</summary>
        <p>
          {draft.city.source === 'qweather'
            ? '无对应日期预报时，天气标为未知。'
            : '手填城市：未填天气按未知处理。'}
        </p>
        <ul>
          {draft.days.map((day, i) => (
            <li key={day.date}>
              第 {i + 1} 天 · {day.date} ·{' '}
              {taxonomy.data?.fields.occasion_codes?.[day.occasion] ?? day.occasion} ·{' '}
              {day.weather
                ? `${day.weather.condition} ${day.weather.temperature_c}℃`
                : '未手填天气'}
            </li>
          ))}
        </ul>
        {draft.notes && <p className="travel-notes">{draft.notes}</p>}
      </details>
    </section>
  )
}
