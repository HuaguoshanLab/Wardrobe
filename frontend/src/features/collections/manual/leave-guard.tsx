import { useEffect } from 'react'
import { useBlocker } from 'react-router'
import { Sheet } from '../../../components/ui/sheet'
import { Button } from '../../../components/ui/button'

export function ManualLeaveGuard({ dirty, sending }: { dirty: boolean; sending: boolean }) {
  const blocker = useBlocker(dirty || sending)
  useEffect(() => {
    if (!sending) return
    const handler = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [sending])
  return (
    <Sheet
      title={sending ? '正在保存' : '离开手动搭配？'}
      trigger={<span hidden />}
      open={blocker.state === 'blocked'}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
    >
      <p>
        {sending
          ? '请等待本次保存完成。'
          : '草稿和未确认的请求会保留在此浏览器，下次打开可继续。离开不会提交或重发。'}
      </p>
      <div className="actions">
        <Button onClick={() => blocker.state === 'blocked' && blocker.reset()}>继续编辑</Button>
        <Button
          variant="outline"
          disabled={sending}
          onClick={() => blocker.state === 'blocked' && blocker.proceed()}
        >
          保留草稿并离开
        </Button>
      </div>
    </Sheet>
  )
}
