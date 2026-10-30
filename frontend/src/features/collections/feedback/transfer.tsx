import { useState } from 'react'
import { ArrowRight, SlidersHorizontal } from 'lucide-react'
import { useNavigate } from 'react-router'
import { Button } from '../../../components/ui/button'
import { FeedbackPreference, stageFeedbackSuggestion } from '../../profile'

export function FeedbackTransfer({ text, disabled }: { text: string; disabled: boolean }) {
  const [mode, setMode] = useState<'next' | 'preference' | null>(() =>
    localStorage.getItem('wardrobe.feedback-preference.pending') ? 'preference' : null,
  )
  const [draft, setDraft] = useState<{ source: string; value: string } | null>(null)
  const [preferenceText, setPreferenceText] = useState<string | null>(() =>
    mode === 'preference' ? text : null,
  )
  const navigate = useNavigate()
  return (
    <aside className="panel feedback-transfer">
      <h2>让反馈帮到下一次</h2>
      <p className="muted">保存反馈只是记下感受。你可以再选择它的用途。</p>
      {disabled && <p className="feedback-use-hint">先保存这次反馈，再使用以下功能。</p>}
      <div className="feedback-purpose-list">
        <Button
          variant="outline"
          className="feedback-purpose"
          disabled={disabled}
          aria-label="用于下次搭配"
          aria-expanded={mode === 'next'}
          aria-controls="feedback-next-preview"
          onClick={() => {
            setDraft((previous) => previous ?? { source: text, value: text })
            setMode(mode === 'next' ? null : 'next')
          }}
        >
          <ArrowRight size={20} aria-hidden="true" />
          <span>
            <strong>用于下次搭配</strong>
            <small>只带到下一次的搭配条件</small>
          </span>
        </Button>
        <Button
          variant="outline"
          className="feedback-purpose"
          disabled={disabled}
          aria-label="保存为长期偏好"
          aria-expanded={mode === 'preference'}
          aria-controls="feedback-preference-preview"
          onClick={() => {
            setPreferenceText((previous) => previous ?? text)
            setMode(mode === 'preference' ? null : 'preference')
          }}
        >
          <SlidersHorizontal size={20} aria-hidden="true" />
          <span>
            <strong>保存为长期偏好</strong>
            <small>核对后，供之后的搭配参考</small>
          </span>
        </Button>
      </div>
      <div id="feedback-next-preview" hidden={mode !== 'next'} className="feedback-preview">
        {draft && (
          <>
            <h3>核对下次搭配参考</h3>
            {draft.source !== text && (
              <p className="form-hint">反馈已修改；这里保留之前的参考文字，请核对后使用。</p>
            )}
            <label>
              下次搭配参考
              <textarea
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
                maxLength={1000}
              />
            </label>
            <p className="form-hint">
              {draft.value.length} / 1000 字 · 在条件页确认加入，点击生成才会使用。
            </p>
            <Button
              disabled={disabled || !draft.value.trim()}
              onClick={() => {
                stageFeedbackSuggestion(draft.value.trim())
                navigate('/outfits/prepare')
              }}
            >
              带到搭配条件
            </Button>
          </>
        )}
      </div>
      <div
        id="feedback-preference-preview"
        hidden={mode !== 'preference'}
        className="feedback-preview"
      >
        {preferenceText !== null && (
          <>
            {preferenceText !== text && (
              <p className="form-hint">反馈已修改；这里保留之前的偏好文字，请核对后保存。</p>
            )}
            <FeedbackPreference text={preferenceText} blocked={disabled} />
          </>
        )}
      </div>
    </aside>
  )
}
