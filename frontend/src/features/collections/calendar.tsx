import { ChevronLeft, ChevronRight } from 'lucide-react'
import { today, type Wear } from './api'

export function monthDays(month: string) {
  const [year, value] = month.split('-').map(Number)
  const offset = (new Date(year, value - 1, 1).getDay() + 6) % 7
  return [
    ...Array.from({ length: offset }, () => null),
    ...Array.from(
      { length: new Date(year, value, 0).getDate() },
      (_, i) => `${month}-${String(i + 1).padStart(2, '0')}`,
    ),
  ]
}
export function shiftMonth(month: string, delta: number) {
  const [year, value] = month.split('-').map(Number)
  const date = new Date(year, value - 1 + delta, 1)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`
}
export function RecordCalendar({
  month,
  date,
  items,
  onMonth,
  onDate,
  loading,
}: {
  month: string
  date: string
  items: Wear[]
  onMonth: (value: string) => void
  onDate: (value: string) => void
  loading: boolean
}) {
  const counts = new Map<string, number>()
  for (const item of items) counts.set(item.worn_on, (counts.get(item.worn_on) ?? 0) + 1)
  return (
    <section className="record-calendar" aria-label="穿着月历" aria-busy={loading}>
      <div className="calendar-month">
        <button
          aria-label="上个月"
          disabled={month <= '1900-01'}
          onClick={() => onMonth(shiftMonth(month, -1))}
        >
          <ChevronLeft size={20} />
        </button>
        <label>
          <input
            aria-label="月份"
            type="month"
            value={month}
            max={today().slice(0, 7)}
            min="1900-01"
            onChange={(e) => {
              if (
                /^\d{4}-(0[1-9]|1[0-2])$/.test(e.target.value) &&
                e.target.value <= today().slice(0, 7)
              )
                onMonth(e.target.value)
            }}
          />
        </label>
        <button
          aria-label="下个月"
          disabled={month >= today().slice(0, 7)}
          onClick={() => onMonth(shiftMonth(month, 1))}
        >
          <ChevronRight size={20} />
        </button>
      </div>
      <div className="calendar-week" aria-hidden="true">
        {['一', '二', '三', '四', '五', '六', '日'].map((day) => (
          <span key={day}>{day}</span>
        ))}
      </div>
      <div className="calendar-days">
        {monthDays(month).map((day, index) =>
          day ? (
            <button
              key={day}
              disabled={day > today()}
              aria-pressed={day === date}
              aria-current={day === today() ? 'date' : undefined}
              aria-label={`${day}${loading ? '，正在读取' : counts.has(day) ? `，${counts.get(day)} 套穿着` : '，无穿着记录'}`}
              onClick={() => onDate(day)}
            >
              <span>{Number(day.slice(-2))}</span>
              <small>{counts.has(day) ? `${counts.get(day)} 套` : '\u00a0'}</small>
            </button>
          ) : (
            <span key={`empty-${index}`} />
          ),
        )}
      </div>
      <div className="calendar-caption">
        <span>{loading ? '正在读取整月记录…' : `本月记录了 ${counts.size} 天`}</span>
        <button
          onClick={() => {
            onMonth(today().slice(0, 7))
            onDate(today())
          }}
        >
          回到今天
        </button>
      </div>
    </section>
  )
}
