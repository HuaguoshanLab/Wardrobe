import './save-options.css'
import type { Dispatch, SetStateAction } from 'react'
import { Bookmark, CalendarDays, Check } from 'lucide-react'
import { today, isPastDay } from '../api'
import type { Draft, Picked } from './state'

export function ManualSaveOptions({
  draft: d,
  setDraft,
  disabled,
  unavailable,
}: {
  draft: Draft
  setDraft: Dispatch<SetStateAction<Draft>>
  disabled: boolean
  unavailable: Picked[]
}) {
  return (
    <aside className="manual-options">
      <fieldset disabled={disabled}>
        <legend>如何留下这套搭配</legend>
        <div className="manual-mode-options">
          {(
            [
              ['save', '保存搭配', '留着以后穿，不计入穿着日历', Bookmark, '保存搭配，留着以后穿'],
              [
                'wear',
                '记录穿着',
                '记下今天或过去实际穿过的组合',
                CalendarDays,
                '直接记录实际穿着',
              ],
            ] as const
          ).map(([mode, title, description, Icon, label]) => (
            <label key={mode} className="manual-mode" data-selected={d.mode === mode}>
              <input
                type="radio"
                name="mode"
                aria-label={label}
                checked={d.mode === mode}
                onChange={() => setDraft((v) => ({ ...v, mode, acknowledged: false }))}
              />
              <Icon size={20} aria-hidden="true" />
              {d.mode === mode && (
                <Check className="manual-mode-check" size={16} aria-hidden="true" />
              )}
              <span>
                <strong>{title}</strong>
                <small>{description}</small>
              </span>
            </label>
          ))}
        </div>
        {d.mode === 'wear' && (
          <div className="manual-wear-fields">
            <label>
              实际穿着日期
              <input
                type="date"
                value={d.date}
                max={today()}
                min="1900-01-01"
                required
                aria-describedby="manual-date-help"
                aria-invalid={!isPastDay(d.date)}
                onChange={(e) =>
                  setDraft((v) => ({ ...v, date: e.target.value, acknowledged: false }))
                }
              />
            </label>
            <small id="manual-date-help" className={isPastDay(d.date) ? 'muted' : 'error'}>
              {isPastDay(d.date) ? '补记以前的穿着，也可以改日期。' : '请选择今天或过去的日期。'}
            </small>
            <label>
              穿着备注（选填）
              <textarea
                value={d.notes}
                maxLength={1000}
                rows={3}
                placeholder="穿起来的感受，或当天的小记"
                onChange={(e) => setDraft((v) => ({ ...v, notes: e.target.value }))}
              />
            </label>
          </div>
        )}
        {!!unavailable.length && (
          <div className="manual-availability">
            <strong>{unavailable.length} 件衣服当前暂不可用</strong>
            <p>{unavailable.map((i) => i.name).join('、')}</p>
            {d.mode === 'save' ? (
              <p>请移除这些衣服，或先在衣橱恢复可穿。若是补记过去的穿着，可选“记录穿着”。</p>
            ) : (
              <label className="manual-confirm">
                <input
                  type="checkbox"
                  checked={d.acknowledged}
                  onChange={(e) => setDraft((v) => ({ ...v, acknowledged: e.target.checked }))}
                />
                <span>我确认所选日期确实穿过这些衣服；保持当前状态</span>
              </label>
            )}
          </div>
        )}
      </fieldset>
    </aside>
  )
}
