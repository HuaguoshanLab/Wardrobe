import './lifecycle-form.css'
import { Button } from '../../components/ui/button'
import { SheetFooter } from '../../components/ui/sheet'
import type { Garment } from './api'
import {
  labels,
  today,
  type LifecycleAction,
  type LifecycleEvent,
  type Subtype,
} from './lifecycle-api'

export type LifeDraft = {
  action: LifecycleAction
  version: number
  occurred_on: string
  reason: string
  changes: Record<string, string | null>
  related_event_id: string | null
}
export function draftFor(
  item: Garment,
  action: LifecycleAction,
  event?: LifecycleEvent,
): LifeDraft {
  const p = item.lifecycle
  const values: Partial<Record<LifecycleAction, Record<string, string | null>>> = {
    profile: {
      source: p.source,
      acquired_on: p.acquired_on,
      price: p.price,
      location: p.location,
      notes: p.notes,
      subtype_id: item.subtype_id,
    },
    condition: { condition: p.condition, fit: p.fit },
    storage: { storage: p.storage, location: p.location },
    availability: { availability: item.availability, unavailable_reason: p.unavailable_reason },
    repair_complete: { condition: 'good', availability: 'available', unavailable_reason: null },
    decision: { decision: p.decision, decision_reason: p.decision_reason },
    retire: { exit_reason: 'other' },
    restore: { availability: item.availability, unavailable_reason: p.unavailable_reason },
  }
  return {
    action,
    version: item.version,
    occurred_on: action === 'correct' ? (event?.occurred_on ?? today()) : today(),
    reason: '',
    changes: values[action] ?? {},
    related_event_id: event?.id ?? null,
  }
}

export function LifecycleForm({
  draft,
  setDraft,
  subtypes,
  busy,
  onSave,
  onAddSubtype,
  submitDisabled = false,
}: {
  draft: LifeDraft
  setDraft: (value: LifeDraft) => void
  subtypes: Subtype[]
  busy: boolean
  onSave: () => void
  submitDisabled?: boolean
  onAddSubtype: () => void
}) {
  const set = (key: string, value: string | null) =>
    setDraft({ ...draft, changes: { ...draft.changes, [key]: value } })
  const select = (key: keyof typeof labels, title: string) => (
    <label>
      {title}
      <select
        aria-label={title}
        value={draft.changes[key] ?? ''}
        onChange={(e) => set(key, e.target.value || null)}
      >
        {Object.entries(labels[key])
          .filter(
            ([value]) =>
              draft.action !== 'repair_complete' ||
              (key === 'condition'
                ? !['unknown', 'needs_repair'].includes(value)
                : key !== 'unavailable_reason' || value !== 'repair'),
          )
          .map(([value, name]) => (
            <option key={value} value={value}>
              {name}
            </option>
          ))}
      </select>
    </label>
  )
  const choices = (key: 'availability' | 'storage' | 'decision', title: string) => (
    <fieldset className="lifecycle-choice-group">
      <legend>{title}</legend>
      <div className="lifecycle-choices">
        {Object.entries(labels[key]).map(([value, name]) => (
          <label key={value} className={draft.changes[key] === value ? 'is-selected' : ''}>
            <input
              type="radio"
              name={key}
              value={value}
              checked={draft.changes[key] === value}
              onChange={() =>
                setDraft({
                  ...draft,
                  changes: {
                    ...draft.changes,
                    [key]: value,
                    ...(key === 'availability' && value === 'available'
                      ? { unavailable_reason: null }
                      : {}),
                  },
                })
              }
            />
            {name}
          </label>
        ))}
      </div>
    </fieldset>
  )
  const text = (key: string, title: string, maxLength: number) => (
    <label>
      {title}
      <input
        aria-label={title}
        value={draft.changes[key] ?? ''}
        maxLength={maxLength}
        onChange={(e) => set(key, e.target.value || (key === 'decision_reason' ? '' : null))}
      />
    </label>
  )
  return (
    <form
      id="lifecycle-form"
      className="lifecycle-form"
      onSubmit={(e) => {
        e.preventDefault()
        onSave()
      }}
    >
      <fieldset disabled={busy}>
        {draft.action === 'profile' && (
          <>
            <p className="lifecycle-form-intro">
              从哪里来，放在哪里。记得多少就填多少，其余可以稍后补充。
            </p>
            {select('source', '获得来源')}
            <label>
              获得日期
              <input
                type="date"
                max={today()}
                value={draft.changes.acquired_on ?? ''}
                onChange={(e) => set('acquired_on', e.target.value || null)}
              />
            </label>
            <label>
              购入金额（元）
              <input
                aria-label="购入金额（元）"
                aria-describedby="lifecycle-price-help"
                type="number"
                inputMode="decimal"
                min="0"
                max="99999999.99"
                step="0.01"
                value={draft.changes.price ?? ''}
                onChange={(e) => set('price', e.target.value || null)}
              />
            </label>
            <small id="lifecycle-price-help">留空是未知，0 元表示没有花费。</small>
            <label>
              子类
              <select
                aria-label="子类"
                value={draft.changes.subtype_id ?? ''}
                onChange={(e) => set('subtype_id', e.target.value || null)}
              >
                <option value="">未分类</option>
                {draft.changes.subtype_id &&
                  !subtypes.some((s) => s.id === draft.changes.subtype_id) && (
                    <option value={draft.changes.subtype_id}>当前子类（信息待读取）</option>
                  )}
                {subtypes
                  .filter((s) => s.active || s.id === draft.changes.subtype_id)
                  .map((s) => (
                    <option value={s.id} key={s.id}>
                      {s.name}
                      {!s.active ? '（已停用）' : ''}
                    </option>
                  ))}
              </select>
            </label>
            <Button variant="outline" className="lifecycle-add-subtype" onClick={onAddSubtype}>
              新增子类
            </Button>
            {text('location', '收纳位置', 120)}
            <label>
              单品备注
              <textarea
                maxLength={2000}
                value={draft.changes.notes ?? ''}
                onChange={(e) => set('notes', e.target.value)}
              />
            </label>
          </>
        )}
        {draft.action === 'condition' && (
          <>
            {select('condition', '衣物状况')}
            {select('fit', '合身情况')}
            <p className="muted">状况不会自动改变可穿状态。</p>
          </>
        )}
        {draft.action === 'storage' && (
          <>
            {choices('storage', '存放状态')}
            {text('location', '收纳位置', 120)}
            <p className="muted">收纳或取出不会清除待洗、维修等不可用原因。</p>
          </>
        )}
        {draft.action === 'decision' && (
          <>
            {choices('decision', '整理决定')}
            {text('decision_reason', '决定原因', 500)}
            <p className="muted">待处理仍然属于你的衣橱，退出需另外确认。</p>
          </>
        )}
        {draft.action === 'repair_start' && <p>开始维修后会标记为“需要维修、暂不可用（维修）”。</p>}
        {draft.action === 'repair_complete' && select('condition', '维修后状况')}
        {['availability', 'repair_complete', 'restore'].includes(draft.action) && (
          <>
            {choices('availability', '当前可用状态')}
            {draft.changes.availability === 'unavailable' &&
              select('unavailable_reason', '暂不可用原因')}
          </>
        )}
        {draft.action === 'retire' && (
          <>
            <div className="lifecycle-exit-notice">
              <strong>给这件衣服留一份档案</strong>
              <p>确认后会移出当前衣橱，不再参与新搭配。照片、档案和已有穿搭记录都会保留。</p>
            </div>
            {select('exit_reason', '退出去向')}
          </>
        )}
        {draft.action === 'restore' && (
          <p>仅用于撤销误退出，保留原单品编号。重新买了一件同款请重新录入。</p>
        )}
        {draft.action === 'correct' && (
          <p>
            追加原记录的日期或原因更正，原记录仍保留，不改变当前状态。状态操作错误请执行对应动作；误退出请使用“撤销退出”。
          </p>
        )}
        <details
          className="lifecycle-record-fields"
          onInvalid={(event) => {
            event.currentTarget.open = true
          }}
          open={['correct', 'restore', 'retire'].includes(draft.action) ? true : undefined}
        >
          <summary>
            {['correct', 'restore', 'retire'].includes(draft.action)
              ? '日期与说明'
              : `记录日期 ${draft.occurred_on} · 可补充说明`}
          </summary>
          <label>
            {draft.action === 'correct' ? '更正后的发生日期' : '本次发生日期'}
            <input
              required
              type="date"
              max={today()}
              value={draft.occurred_on}
              onChange={(e) => setDraft({ ...draft, occurred_on: e.target.value })}
            />
          </label>
          <label>
            {draft.action === 'correct' ? '更正说明' : '本次说明'}
            <textarea
              required={['correct', 'restore'].includes(draft.action)}
              maxLength={500}
              placeholder={
                ['correct', 'restore'].includes(draft.action)
                  ? '请说明这次更正的原因'
                  : '选填，例如：换季收进防尘袋'
              }
              value={draft.reason}
              onChange={(e) => setDraft({ ...draft, reason: e.target.value })}
            />
          </label>
        </details>
      </fieldset>
      <SheetFooter>
        <Button
          type="submit"
          form="lifecycle-form"
          disabled={busy || submitDisabled}
          className={draft.action === 'retire' ? 'button-danger' : ''}
        >
          {busy
            ? '正在处理…'
            : draft.action === 'retire'
              ? '确认退出衣橱'
              : draft.action === 'restore'
                ? '确认撤销退出'
                : '保存记录'}
        </Button>
      </SheetFooter>
    </form>
  )
}
