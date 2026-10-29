import { Button } from '../../components/ui/button'
import {
  labels,
  lifecycleNames,
  type LifecycleAction,
  type LifecycleEvent,
  type Subtype,
} from './lifecycle-api'

export function LifecycleTimeline({
  events,
  subtypes,
  busy,
  onCorrect,
}: {
  events: LifecycleEvent[]
  subtypes: Subtype[]
  busy: boolean
  onCorrect: (event: LifecycleEvent) => void
}) {
  return (
    <ol className="lifecycle-events">
      {events.map((e) => (
        <li key={e.id}>
          <time dateTime={e.occurred_on}>{e.occurred_on}</time>
          <strong>{lifecycleNames[e.action as LifecycleAction] ?? e.action}</strong>
          {e.reason && <p>{e.reason}</p>}
          {e.action !== 'correct' && (
            <p className="lifecycle-event-summary">
              {changedFields(e)
                .slice(0, 3)
                .map((key) => `${titles[key]}：${display(key, flatten(e.after)[key], subtypes)}`)
                .join(' · ') || '已确认当前状态'}
            </p>
          )}
          <details>
            <summary>详情与更正</summary>
            <EventChanges event={e} subtypes={subtypes} />
            {e.related_event_id && (
              <p className="muted">
                {(() => {
                  const related = events.find((old) => old.id === e.related_event_id)
                  return related
                    ? `关联 ${related.occurred_on} 的“${lifecycleNames[related.action as LifecycleAction] ?? related.action}”记录`
                    : '关联较早的记录，可加载更早记录查看'
                })()}
              </p>
            )}
            <small>
              保存于 {new Date(e.recorded_at).toLocaleString('zh-CN')} · 记录版本 {e.version}
            </small>
            {e.action !== 'correct' && (
              <Button variant="outline" disabled={busy} onClick={() => onCorrect(e)}>
                更正这条记录
              </Button>
            )}
          </details>
        </li>
      ))}
    </ol>
  )
}
const titles: Record<string, string> = {
  ownership: '持有',
  subtype_id: '子类',
  availability: '可用状态',
  source: '获得来源',
  acquired_on: '获得日期',
  price: '金额（元）',
  location: '位置',
  condition: '状况',
  fit: '合身',
  storage: '存放',
  unavailable_reason: '不可用原因',
  decision: '整理决定',
  decision_reason: '决定原因',
  notes: '备注',
  exit_reason: '退出去向',
  exited_on: '退出日期',
}
const flatten = (state: LifecycleEvent['after']) =>
  ({
    ...state,
    ...(state.profile as Record<string, unknown>),
    profile: undefined,
  }) as Record<string, unknown>
const changedFields = (event: LifecycleEvent) =>
  Object.keys(titles).filter((key) => flatten(event.before)[key] !== flatten(event.after)[key])
const display = (key: string, value: unknown, subtypes: Subtype[]) => {
  if (value === null || value === undefined || value === '') return '未填写'
  if (key === 'ownership') return value === 'retired' ? '已退出' : '持有'
  if (key === 'subtype_id') return subtypes.find((s) => s.id === value)?.name ?? '子类信息待读取'
  const choices = labels[key as keyof typeof labels] as Record<string, string> | undefined
  return choices?.[String(value)] ?? String(value)
}
function EventChanges({ event, subtypes }: { event: LifecycleEvent; subtypes: Subtype[] }) {
  const before = flatten(event.before),
    after = flatten(event.after)
  const changed = changedFields(event)
  return changed.length ? (
    <dl className="lifecycle-event-state">
      {changed.map((key) => (
        <div key={key} style={{ display: 'contents' }}>
          <dt>{titles[key]}</dt>
          <dd>
            {display(key, before[key], subtypes)} → {display(key, after[key], subtypes)}
          </dd>
        </div>
      ))}
    </dl>
  ) : (
    <p className="muted">
      {event.action === 'correct'
        ? '仅追加更正说明，当前状态未改变。'
        : '已记录本次确认，字段值未改变。'}
    </p>
  )
}
