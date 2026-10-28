import { useEffect, useRef, useState } from 'react'
import { useBlocker, useNavigate } from 'react-router'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'
import { OperationNotice } from '../../components/ui/operation-notice'
import { useOperation } from '../../lib/use-operation'
import { refreshAction } from './recovery'
import { sessionSchema } from '../outfits'
import { RecordActionForm, actionTitle, type RecordAction } from './action-form'

export function useRecordActions() {
  const [action, setAction] = useState<RecordAction | null>(null)
  const [dirty, setDirty] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [refreshError, setRefreshError] = useState('')
  const focus = useRef<HTMLElement | null>(null)
  const form = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const op = useOperation('collections', (value, path) => {
    setAction(null)
    setDirty(false)
    setDiscard(false)
    if (path === '/outfit-sessions') navigate(`/outfits/${sessionSchema.parse(value).id}`)
  })
  const blocker = useBlocker(!!action && (dirty || op.sending))
  useEffect(() => {
    if (!dirty && !op.sending) return
    const handler = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, op.sending])
  const refresh = async () => {
    if (!action || op.sending || refreshing) return
    setRefreshing(true)
    setRefreshError('')
    try {
      const latest = await refreshAction(action)
      setAction(latest)
      op.discard()
    } catch (error) {
      setRefreshError(error instanceof Error ? error.message : '读取失败，请重试')
    } finally {
      setRefreshing(false)
    }
  }
  const close = () => {
    if (op.sending || refreshing) return
    if (dirty) setDiscard(true)
    else setAction(null)
  }
  return {
    busy: op.busy,
    open: (next: RecordAction) => {
      focus.current = document.activeElement as HTMLElement
      setDirty(false)
      setRefreshError('')
      setDiscard(false)
      setAction(next)
    },
    feedback: !action && <OperationNotice operation={op} />,
    panel: (
      <>
        <Sheet
          title={action ? actionTitle(action) : '搭配操作'}
          trigger={<span hidden />}
          open={!!action}
          onOpenChange={(value) => {
            if (!value) close()
          }}
          finalFocus={() => (focus.current?.isConnected ? focus.current : false)}
        >
          {action && (
            <div ref={form}>
              <RecordActionForm
                key={`${action.kind}:${action.revision.id}`}
                action={action}
                op={{ ...op, busy: op.busy || refreshing }}
                onDirty={setDirty}
              />
              <OperationNotice
                operation={{
                  ...op,
                  notice: '',
                  discard: () => void refresh(),
                  sending: op.sending || refreshing,
                }}
              />
              {op.pending && (
                <p className="muted">
                  放弃待发操作会读取最新版本并保留你的修改，请核对后再次保存。
                </p>
              )}
              {refreshError && (
                <p className="error" role="alert">
                  {refreshError}
                </p>
              )}
            </div>
          )}
        </Sheet>
        <Sheet
          title={op.sending ? '正在保存' : '放弃未保存的修改？'}
          trigger={<span hidden />}
          open={discard || blocker.state === 'blocked'}
          onOpenChange={(value) => {
            if (!value) {
              setDiscard(false)
              if (blocker.state === 'blocked') blocker.reset()
            }
          }}
          finalFocus={() => form.current?.querySelector('input') ?? false}
        >
          <p>{op.sending ? '请等待本次操作完成。' : '本次编辑尚未保存，离开后将放弃这些修改。'}</p>
          <div className="actions">
            <Button
              onClick={() => {
                setDiscard(false)
                if (blocker.state === 'blocked') blocker.reset()
              }}
            >
              继续编辑
            </Button>
            <Button
              variant="outline"
              disabled={op.sending}
              onClick={() => {
                setDiscard(false)
                setDirty(false)
                setAction(null)
                if (blocker.state === 'blocked') blocker.proceed()
              }}
            >
              放弃修改
            </Button>
          </div>
        </Sheet>
      </>
    ),
  }
}
