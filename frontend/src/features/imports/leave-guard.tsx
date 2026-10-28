import { useEffect } from 'react'
import { useBlocker } from 'react-router'
import { Sheet } from '../../components/ui/sheet'
import { Button } from '../../components/ui/button'

export function LeaveGuard({
  dirty,
  busy = false,
  allowLeave,
}: {
  dirty: boolean
  busy?: boolean
  allowLeave?: () => boolean
}) {
  const blocker = useBlocker(() => !allowLeave?.() && (dirty || busy))
  useEffect(() => {
    if (!dirty && !busy) return
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [dirty, busy])
  return (
    <Sheet
      title={busy ? '操作正在进行' : '离开当前编辑？'}
      trigger={<span hidden />}
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
    >
      <p>
        {busy
          ? '请等待本次请求返回，再离开页面。'
          : '当前未保存的修改或所选文件将丢失。已经上传的批次仍会保留。'}
      </p>
      <div className="actions">
        <Button onClick={() => blocker.state === 'blocked' && blocker.reset()}>继续编辑</Button>
        <Button
          variant="outline"
          disabled={busy}
          onClick={() => blocker.state === 'blocked' && blocker.proceed()}
        >
          确认离开
        </Button>
      </div>
    </Sheet>
  )
}
