import { useEffect } from 'react'
import { useBlocker } from 'react-router'
import { Sheet } from '../../../components/ui/sheet'
import { Button } from '../../../components/ui/button'

export function DraftGuard({ dirty, sending }: { dirty: boolean; sending: boolean }) {
  const blocker = useBlocker(dirty || sending)
  useEffect(() => {
    if (!dirty && !sending) return
    const stop = (e: BeforeUnloadEvent) => e.preventDefault()
    window.addEventListener('beforeunload', stop)
    return () => window.removeEventListener('beforeunload', stop)
  }, [dirty, sending])
  return (
    <Sheet
      title={sending ? '正在保存' : '放弃未保存的修改？'}
      open={blocker.state === 'blocked'}
      trigger={<button hidden type="button" />}
      onOpenChange={(open) => {
        if (!open && blocker.state === 'blocked') blocker.reset()
      }}
    >
      <p>未保存的输入将被放弃。结果未确认的原请求仍可恢复重发。</p>
      <Button onClick={() => blocker.state === 'blocked' && blocker.reset()}>继续编辑</Button>
      <Button
        variant="outline"
        disabled={sending}
        onClick={() => blocker.state === 'blocked' && blocker.proceed()}
      >
        放弃修改
      </Button>
    </Sheet>
  )
}
