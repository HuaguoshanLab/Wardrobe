import { useEffect, useId, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { SheetFooter } from '../../../components/ui/sheet'
import { Button } from '../../../components/ui/button'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import { getGarment, type Garment } from '../api'
import { today } from '../lifecycle-api'
import { getExitImpact } from './api'
import { ExitImpactView } from './exit-impact'

export function ProcessForm({
  item,
  onDone,
  onDirty,
  onSending,
}: {
  item: Garment
  onDone: () => void
  onDirty: () => void
  onSending: (v: boolean) => void
}) {
  const formId = useId()
  const operation = useOperation(`organization-process.${item.id}`, () => {
    onSending(false)
    onDone()
  })
  const pending = operation.pending?.body
  const recovered =
    pending && typeof pending === 'object' && !Array.isArray(pending) ? pending : null
  const [action, setAction] = useState(
    typeof recovered?.action === 'string' ? recovered.action : 'repair',
  )
  const [date, setDate] = useState(
    typeof recovered?.occurred_on === 'string' ? recovered.occurred_on : today(),
  )
  const [reason, setReason] = useState(
    typeof recovered?.reason === 'string' ? recovered.reason : '',
  )
  const [ack, setAck] = useState(false)
  const [repairVersion, setRepairVersion] = useState(item.version)
  const [reading, setReading] = useState(false)
  const [readError, setReadError] = useState('')
  useEffect(() => setRepairVersion(item.version), [item.version])
  const preview = useQuery({
    queryKey: ['exit-impact', item.id],
    queryFn: () => getExitImpact(item.id),
    enabled: action !== 'repair',
    refetchOnWindowFocus: false,
  })
  useEffect(() => onSending(operation.sending), [operation.sending, onSending])
  const impact = preview.data
  useEffect(() => setAck(false), [impact?.token])
  return (
    <form
      id={formId}
      className="organization-form organization-process-form"
      onSubmit={(e) => {
        e.preventDefault()
        operation.send(`/organization/${item.id}/process`, 'POST', {
          garment_version: action === 'repair' ? repairVersion : impact!.garment_version,
          action,
          occurred_on: date,
          reason,
          impact_token: action === 'repair' ? null : impact!.token,
        })
      }}
    >
      <div className="organization-item organization-process-item">
        <img src={item.image_url} alt="" />
        <div>
          <span className="organization-kicker">处理对象</span>
          <p>{item.name ?? '未命名单品'}</p>
        </div>
      </div>
      <fieldset
        disabled={operation.busy || reading}
        onChange={() => {
          onDirty()
          setAck(false)
        }}
      >
        <legend>1 · 选择实际处理方式</legend>
        <label>
          实际处理方式
          <select
            aria-label="实际处理方式"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <optgroup label="继续持有">
              <option value="repair">开始维修 / 改衣</option>
            </optgroup>
            <optgroup label="退出衣橱">
              <option value="gifted">转赠</option>
              <option value="sold">出售</option>
              <option value="recycled">回收</option>
              <option value="discarded">丢弃</option>
              <option value="other">其他退出</option>
            </optgroup>
          </select>
        </label>
        <label>
          实际发生日期
          <input
            required
            type="date"
            max={today()}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <label>
          原因或说明
          <textarea maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
        </label>
      </fieldset>
      {action === 'repair' ? (
        <p className="notice">
          保存后记为维修中、暂不可穿；仍是持有库存。完成维修请在生命周期中重新确认状况与可用性。
        </p>
      ) : (
        <>
          {preview.isFetching && <p role="status">正在核对全部季节…</p>}
          {preview.error && <p role="alert">{preview.error.message}</p>}
          {impact && <ExitImpactView impact={impact} />}
          <Button
            variant="outline"
            disabled={operation.sending || preview.isFetching}
            onClick={async () => {
              setAck(false)
              const latest = await preview.refetch()
              if (!latest.isError) operation.discard()
            }}
          >
            重新核对退出影响
          </Button>
          <label className="organization-check">
            <input
              type="checkbox"
              checked={ack}
              disabled={!impact || preview.isFetching || operation.busy}
              onChange={(e) => {
                setAck(e.target.checked)
                onDirty()
              }}
            />
            已核对全部季节影响，确认实际退出
          </label>
        </>
      )}
      <OperationNotice operation={operation} />
      {readError && <p role="alert">{readError}</p>}
      {operation.pending && action === 'repair' && (
        <Button
          variant="outline"
          disabled={operation.sending || reading}
          onClick={async () => {
            setReading(true)
            setReadError('')
            try {
              const latest = await getGarment(item.id)
              if (latest.ownership !== 'owned') throw new Error('单品已退出，请返回整理清单核对')
              setRepairVersion(latest.version)
              operation.discard()
            } catch (e) {
              setReadError(e instanceof Error ? e.message : '读取失败，请重试')
            } finally {
              setReading(false)
            }
          }}
        >
          结束原请求重试，重新核对单品
        </Button>
      )}
      <SheetFooter>
        <Button
          type="submit"
          className={action === 'repair' ? undefined : 'organization-confirm-exit'}
          form={formId}
          disabled={
            operation.busy ||
            reading ||
            (action !== 'repair' && (!ack || !impact || preview.isFetching || preview.isError))
          }
        >
          {operation.sending
            ? '正在保存…'
            : action === 'repair'
              ? '确认开始维修 / 改衣'
              : '确认退出衣橱'}
        </Button>
      </SheetFooter>
    </form>
  )
}
