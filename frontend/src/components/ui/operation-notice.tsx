import { Button } from './button'
import type { OperationController } from '../../lib/use-operation'
export function OperationNotice({ operation: op }: { operation: OperationController }) {
  return (
    <>
      {op.error && (
        <p role="alert" className="error">
          {op.error.message}
        </p>
      )}
      {op.notice && <p role="status">{op.notice}</p>}
      {op.pending && (
        <div className="notice">
          <p>操作结果尚未确认。刷新不会自动重发。</p>
          <Button disabled={op.sending} onClick={op.resend}>
            重发同一操作
          </Button>
          <Button variant="outline" disabled={op.sending} onClick={op.discard}>
            放弃待发操作并刷新
          </Button>
        </div>
      )}
    </>
  )
}
