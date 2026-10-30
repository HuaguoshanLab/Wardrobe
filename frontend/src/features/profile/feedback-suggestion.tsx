import { useState } from 'react'
import { Button } from '../../components/ui/button'

const key = 'wardrobe.feedback.next'
export function stageFeedbackSuggestion(text: string) {
  localStorage.setItem(key, text)
}
export function FeedbackSuggestion({
  notes,
  onApply,
}: {
  notes: string
  onApply: (notes: string) => void
}) {
  const [text, setText] = useState(() => localStorage.getItem(key) ?? '')
  const [added, setAdded] = useState(false)
  const [visible, setVisible] = useState(() => localStorage.getItem(key) !== null)
  const merged = [notes.trim(), text.trim()].filter(Boolean).join('\n')
  if (!visible) return null
  return (
    <section className="notice" aria-label="穿后反馈参考">
      {added ? (
        <p role="status">穿后反馈已加入本次补充，可继续编辑。点击生成才会使用。</p>
      ) : (
        <>
          <label>
            待加入的穿后反馈
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value)
                localStorage.setItem(key, e.target.value)
              }}
            />
          </label>
          <p className="form-hint">
            合并后 {merged.length} / 1000 字 · 保留已有补充，确认加入后才会使用。
          </p>
          {merged.length > 1000 && <p role="alert">合并后超过 1000 字，请先精简文字。</p>}
          <div className="actions">
            <Button
              type="button"
              disabled={!text.trim() || merged.length > 1000}
              onClick={() => {
                onApply(merged)
                localStorage.removeItem(key)
                setText('')
                setAdded(true)
              }}
            >
              加入本次补充
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                localStorage.removeItem(key)
                setText('')
                setVisible(false)
              }}
            >
              暂不使用
            </Button>
          </div>
        </>
      )}
    </section>
  )
}
