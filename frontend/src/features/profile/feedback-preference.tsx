import { useState } from 'react'
import { z } from 'zod'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router'
import { Button } from '../../components/ui/button'
import { OperationNotice } from '../../components/ui/operation-notice'
import { useOperation } from '../../lib/use-operation'
import { getPreferences } from './api'

export function FeedbackPreference({ text, blocked = false }: { text: string; blocked?: boolean }) {
  const query = useQuery({ queryKey: ['preferences'], queryFn: getPreferences })
  const [draft, setDraft] = useState<{ notes: string; version: number } | null>(null)
  const [saved, setSaved] = useState(false)
  const op = useOperation('feedback-preference', () => {
    setSaved(true)
    setDraft(null)
  })
  const original = z
    .object({ preferences: z.object({ notes: z.string() }), expected_version: z.number() })
    .safeParse(op.pending?.body)
  const notes = original.success
    ? original.data.preferences.notes
    : (draft?.notes ?? [query.data?.preferences.notes, text].filter(Boolean).join('\n'))
  return (
    <section className="feedback-preference">
      <h3>核对长期偏好</h3>
      <p className="form-hint">编辑下方完整说明。只保存补充文字，其他偏好保持不变。</p>
      {query.isPending && <p role="status">正在读取已有偏好…</p>}
      {query.error && (
        <p role="alert">
          {query.error.message}
          <Button onClick={() => void query.refetch()}>重新读取偏好</Button>
        </p>
      )}
      {!saved && query.data && (
        <>
          <details className="feedback-existing">
            <summary>查看原有补充</summary>
            <p>{query.data.preferences.notes || '未填写'}</p>
          </details>
          <label>
            长期偏好补充
            <textarea
              value={notes}
              disabled={op.busy}
              onChange={(e) =>
                setDraft({ notes: e.target.value, version: draft?.version ?? query.data.version })
              }
            />
          </label>
          <p className={notes.length > 1000 ? 'error' : 'muted'}>
            {notes.length} / 1000 字；超出时请编辑精简，不会截断原内容。
          </p>
          <Button
            disabled={blocked || op.busy || notes.length > 1000 || !notes.trim()}
            onClick={() =>
              op.send('/profile/preferences', 'PATCH', {
                expected_version: draft?.version ?? query.data.version,
                preferences: { notes: notes.trim() },
              })
            }
          >
            确认保存长期偏好
          </Button>
          {op.error && (
            <Button
              variant="outline"
              disabled={op.sending}
              onClick={async () => {
                const result = await query.refetch()
                if (result.isSuccess && result.data) {
                  op.discard()
                  setDraft({ notes, version: result.data.version })
                }
              }}
            >
              保留输入，读取最新偏好版本
            </Button>
          )}
        </>
      )}
      <OperationNotice operation={{ ...op, notice: '' }} />
      {saved && <p role="status">偏好已保存。已保存的穿后反馈独立保留。</p>}
      <p className="form-hint">
        删除反馈不会撤回已保存的偏好。<Link to="/settings/preferences">管理长期偏好</Link>
      </p>
    </section>
  )
}
