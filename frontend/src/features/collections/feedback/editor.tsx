import { useEffect, useState } from 'react'
import { z } from 'zod'
import { Button } from '../../../components/ui/button'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import type { Wear } from '../api'
import { RecordPreview } from '../preview'
import {
  emptyFeedback,
  feedbackData,
  feedbackText,
  feedbackView,
  type Feedback,
  type FeedbackView,
} from './api'
import { FeedbackFeelings } from './feelings'
import { FeedbackTransfer } from './transfer'

export function FeedbackEditor({
  wear,
  initial,
  reload,
}: {
  wear: Wear
  initial: FeedbackView
  reload: () => Promise<FeedbackView | undefined>
}) {
  const storageKey = `wardrobe.feedback.${wear.id}.draft`
  const [draft, setDraft] = useState(() => {
    try {
      return z
        .object({ feedback: feedbackData, version: z.int().nonnegative() })
        .parse(JSON.parse(localStorage.getItem(storageKey) ?? 'null'))
    } catch {
      return { feedback: initial.feedback ?? emptyFeedback, version: initial.version }
    }
  })
  const [saved, setSaved] = useState(initial)
  const [message, setMessage] = useState('')
  const [confirm, setConfirm] = useState(false)
  const op = useOperation(`feedback.${wear.id}`, (value) => {
    const result = feedbackView.parse(value)
    setSaved(result)
    setDraft({ feedback: result.feedback ?? emptyFeedback, version: result.version })
    setConfirm(false)
    setMessage(
      result.feedback ? '反馈已保存，尚未修改长期偏好。' : '反馈已删除，独立保存的长期偏好保持。',
    )
  })
  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify(draft))
  }, [storageKey, draft])
  const data = draft.feedback
  const dirty =
    JSON.stringify(data) !== JSON.stringify(saved.feedback ?? emptyFeedback) ||
    draft.version !== saved.version
  const meaningful = !!(data.thermal || data.comfort || data.color || data.notes.trim())
  const items = wear.revision.items.filter((item) => item.source === 'wardrobe' && item.garment_id)
  const target = data.garment_id
    ? String(
        items.find((item) => item.garment_id === data.garment_id)?.attributes.name || '这件单品',
      )
    : '这套搭配'
  function change<K extends keyof Feedback>(key: K, value: Feedback[K]) {
    setDraft({ ...draft, feedback: { ...data, [key]: value } })
    setMessage('')
  }
  return (
    <>
      <section className="feedback-context">
        <RecordPreview revision={wear.revision} />
        <div>
          <strong>{wear.worn_on}</strong>
          <p>实际穿着 · {items.length} 件衣服</p>
        </div>
      </section>
      <div className="feedback-workspace">
        <div className="feedback-main">
          <form
            className="panel feedback-form"
            onSubmit={(event) => {
              event.preventDefault()
              if (meaningful && dirty && !op.busy)
                op.send(`/wear-records/${wear.id}/feedback`, 'PATCH', {
                  expected_version: draft.version,
                  feedback: data,
                })
            }}
          >
            <div className="feedback-section-heading">
              <h2>这次穿得怎么样？</h2>
              <p className="muted">只填有感受的项目，其余可以留空。</p>
            </div>
            <fieldset disabled={op.busy} className="plain-fieldset">
              <label>
                反馈对象
                <select
                  value={data.garment_id ?? ''}
                  onChange={(e) => change('garment_id', e.target.value || null)}
                >
                  <option value="">整套搭配</option>
                  {items.map((item) => (
                    <option key={item.garment_id} value={item.garment_id!}>
                      {String(item.attributes.name || '单品')}
                    </option>
                  ))}
                </select>
              </label>
              <p className="form-hint feedback-target">
                {data.garment_id ? `当前对象：${target}。` : ''}
                每次穿着保留一份反馈，更换对象会更新原反馈。
              </p>
              <FeedbackFeelings data={data} onChange={change} />
              <label>
                感受备注（可选）
                <textarea
                  maxLength={500}
                  value={data.notes}
                  onChange={(e) => change('notes', e.target.value)}
                />
              </label>
              <p className="form-hint feedback-count">{data.notes.length} / 500 字</p>
            </fieldset>
            <div className="feedback-save">
              <div role="status">
                <strong>
                  {op.busy
                    ? '等待保存结果'
                    : dirty
                      ? '有未保存修改'
                      : saved.feedback
                        ? '反馈已保存'
                        : '尚未填写反馈'}
                </strong>
                <p className="form-hint">
                  {!meaningful
                    ? '选择一种感受或填写备注。'
                    : dirty
                      ? '草稿保留在本浏览器。'
                      : '可选择如何使用这份反馈。'}
                </p>
              </div>
              <Button type="submit" disabled={op.busy || !meaningful || !dirty}>
                {op.sending ? '正在保存…' : '保存反馈'}
              </Button>
            </div>
          </form>
          <OperationNotice operation={{ ...op, notice: '' }} />
          {message && (
            <p role="status" className="notice">
              {message}
            </p>
          )}
          {op.error && (
            <Button
              variant="outline"
              disabled={op.sending}
              onClick={async () => {
                const fresh = await reload()
                if (fresh) {
                  op.discard()
                  setSaved(fresh)
                  setDraft({ ...draft, version: fresh.version })
                  setMessage('已读取最新版本，输入仍保留；核对后再保存。')
                }
              }}
            >
              保留输入，读取最新反馈版本
            </Button>
          )}
        </div>
        <FeedbackTransfer
          text={feedbackText(data, target, wear.worn_on)}
          disabled={dirty || op.busy || !saved.feedback}
        />
      </div>
      {!!saved.feedback && (
        <section className="feedback-delete">
          <Button
            variant="outline"
            disabled={op.busy}
            aria-expanded={confirm}
            onClick={() => setConfirm(!confirm)}
          >
            删除反馈
          </Button>
          {confirm && (
            <div className="notice">
              <p>仅删除这份反馈，已保存的长期偏好和搭配快照保持。未保存的反馈修改也会清除。</p>
              <Button
                disabled={op.busy}
                onClick={() =>
                  op.send(`/wear-records/${wear.id}/feedback`, 'DELETE', undefined, saved.version)
                }
              >
                确认删除反馈
              </Button>
            </div>
          )}
        </section>
      )}
    </>
  )
}
