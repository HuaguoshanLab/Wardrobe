import { useEffect, useState } from 'react'
import { useBlocker } from 'react-router'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'

export function EditGuard({
  dirty,
  busy,
  onDiscard,
}: {
  dirty: boolean
  busy: boolean
  onDiscard: () => Promise<void> | void
}) {
  const blocker = useBlocker(dirty || busy)
  const [discard, setDiscard] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  useEffect(() => {
    if (!dirty && !busy) return
    const handler = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, busy])
  const close = () => {
    if (loading) return
    setDiscard(false)
    setError('')
    if (blocker.state === 'blocked') blocker.reset()
  }
  return (
    <>
      {dirty && (
        <button className="text-link" disabled={busy} onClick={() => setDiscard(true)}>
          放弃修改
        </button>
      )}
      <Sheet
        title={busy ? '正在保存' : '放弃未保存的修改？'}
        trigger={<span hidden />}
        open={discard || blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open) close()
        }}
      >
        <p>
          {busy
            ? '请等待本次保存完成。'
            : '离开或重新读取将放弃本次修改。未确认的保存可能已在服务端完成，请以最新设置为准。'}
        </p>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <div className="actions">
          <Button disabled={loading} onClick={close}>
            继续编辑
          </Button>
          <Button
            variant="outline"
            disabled={busy || loading}
            onClick={async () => {
              setLoading(true)
              try {
                await onDiscard()
                if (blocker.state === 'blocked') blocker.proceed()
                setDiscard(false)
              } catch (reason) {
                setError(reason instanceof Error ? reason.message : '读取失败，请重试')
              } finally {
                setLoading(false)
              }
            }}
          >
            {loading ? '正在读取…' : '确认放弃'}
          </Button>
        </div>
      </Sheet>
    </>
  )
}
