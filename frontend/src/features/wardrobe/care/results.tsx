import { useEffect, useRef } from 'react'
import { Link } from 'react-router'
import { Button } from '../../../components/ui/button'
import { waitForSheetCleanup } from '../../../components/ui/sheet-history'
import { actions } from './api'
import type { CareOperation } from './use-care-operation'

export function CareResults({
  operation,
  onRetry,
  returnTo,
}: {
  operation: CareOperation
  onRetry: () => void
  returnTo: string
}) {
  const { pending, saved, error } = operation
  const feedback = useRef<HTMLDivElement>(null)
  const previous = useRef({ saved, error })
  useEffect(() => {
    const changed = previous.current.saved !== saved || previous.current.error !== error
    previous.current = { saved, error }
    if (!changed || (!saved && !error)) return
    let cancelled = false
    void waitForSheetCleanup().then(() => {
      if (cancelled) return
      feedback.current?.focus({ preventScroll: true })
      feedback.current?.scrollIntoView({ block: 'start' })
    })
    return () => {
      cancelled = true
    }
  }, [saved, error])
  if (!pending && !saved && !error) return null
  const failed = saved?.result.items.filter((i) => !i.success) ?? []
  const succeeded = saved?.result.items.filter((i) => i.success) ?? []
  const name = (id: string) => saved?.selected.find((g) => g.id === id)?.name || '未命名单品'
  return (
    <div className="care-feedback" ref={feedback} tabIndex={-1} aria-label="批量操作反馈">
      {pending && (
        <section className="panel care-recovery" aria-label="待确认的批量请求">
          <span className="care-kicker">{operation.sending ? '处理中' : '结果待确认'}</span>
          <h2>{operation.sending ? '正在逐件处理…' : '这次操作还没有收到完整结果'}</h2>
          <p>
            <strong>{actions[pending.body.items[0].action]}</strong> · {pending.selected.length} 件
          </p>
          <details>
            <summary>查看本次处理的单品</summary>
            <ul>
              {pending.selected.map((g) => (
                <li key={g.id}>{g.name || '未命名单品'}</li>
              ))}
            </ul>
          </details>
          <p>刷新不会自动重发。使用原请求读取结果，已完成的单品不会重复处理。</p>
          {error && <p role="alert">{error.message}</p>}
          <div className="actions">
            <Button disabled={operation.sending} onClick={operation.resend}>
              {operation.sending ? '正在处理，请稍候' : '重发原批量请求'}
            </Button>
            {operation.rejected && (
              <Button variant="outline" onClick={operation.editRejected}>
                请求被拒绝，返回编辑
              </Button>
            )}
          </div>
        </section>
      )}
      {!pending && error && <p role="alert">{error.message}</p>}
      {saved && !pending && (
        <section
          className="panel care-results"
          data-partial={!!failed.length}
          aria-label="批量操作结果"
        >
          <span className="care-kicker">{failed.length ? '还有单品需要处理' : '本次处理完成'}</span>
          <h2>{actions[saved.body.items[0].action]}</h2>
          <p role="status" className="care-result-count">
            成功 {succeeded.length} 件，未成功 {failed.length} 件
          </p>
          {!!failed.length && (
            <>
              <p>成功项已移出选择。下面的单品保持原样，可查看状态后重新核对。</p>
              <ul className="care-failed-items">
                {failed.map((i) => (
                  <li key={i.id}>
                    <strong>{name(i.garment_id)}</strong>
                    <span>未成功 · {i.message}</span>
                    <Link
                      className="text-link"
                      to={`/wardrobe/${i.garment_id}/lifecycle`}
                      state={{ careReturn: returnTo }}
                    >
                      查看此单品状态
                    </Link>
                  </li>
                ))}
              </ul>
              <Button variant="outline" disabled={operation.busy} onClick={onRetry}>
                只选未成功项，重新核对
              </Button>
            </>
          )}
          {!!succeeded.length && (
            <details className="care-success-details">
              <summary>查看 {succeeded.length} 件成功明细</summary>
              <ul>
                {succeeded.map((i) => (
                  <li key={i.id}>
                    <strong>{name(i.garment_id)}</strong>
                    <span>成功 · {i.changed ? i.message : '已符合设置，无需修改'}</span>
                  </li>
                ))}
              </ul>
            </details>
          )}
          <div className="care-result-footer">
            <p className="care-help">此处保留当次结果，之后的修改以单品当前资料为准。</p>
            <Button variant="outline" disabled={operation.busy} onClick={operation.dismiss}>
              收起结果
            </Button>
          </div>
        </section>
      )}
    </div>
  )
}
