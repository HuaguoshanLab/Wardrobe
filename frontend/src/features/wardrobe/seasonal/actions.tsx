import { useEffect, useId, useRef, useState } from 'react'
import { useForm } from 'react-hook-form'
import { useQuery } from '@tanstack/react-query'
import { Sheet, SheetFooter } from '../../../components/ui/sheet'
import { ActionPicker } from './action-picker'
import { ActionHistory } from './action-history'
import { Button } from '../../../components/ui/button'
import type { OperationController } from '../../../lib/use-operation'
import { entityId } from '../../../lib/id'
import { today } from '../lifecycle-api'
import { getExitImpact } from '../organization/api'
import { ExitImpactView } from '../organization/exit-impact'
import type { Seasonal } from './api'

const choices = {
  stored: '换季收纳',
  daily: '取回日常',
  repair: '开始维修',
  keep: '继续保留',
  gifted: '转赠',
  sold: '出售',
  recycled: '回收',
  discarded: '丢弃',
  other: '其他退出',
}
type Choice = keyof typeof choices
export function Actions({
  session,
  operation,
  onDirty,
}: {
  session: Seasonal
  operation: OperationController
  onDirty: (v: boolean) => void
}) {
  const formId = useId()
  const formRef = useRef<HTMLFormElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const [confirming, setConfirming] = useState(false)
  const [selected, setSelected] = useState<string[]>([])
  const [confirmed, setConfirmed] = useState(false)
  const form = useForm({
    defaultValues: { choice: 'stored' as Choice, date: today(), reason: '', location: '' },
  })
  const choice = form.watch('choice')
  const exit = ['gifted', 'sold', 'recycled', 'discarded', 'other'].includes(choice)
  const items = session.items.filter((i) => i.current?.ownership === 'owned')
  const picked = items.filter((i) => selected.includes(i.garment_id))
  const dirty = selected.length > 0 || form.formState.isDirty
  useEffect(() => onDirty(dirty), [dirty, onDirty])
  const impact = useQuery({
    queryKey: ['exit-impact', selected[0]],
    queryFn: () => getExitImpact(selected[0]),
    enabled: confirming && exit && selected.length === 1,
    refetchOnWindowFocus: false,
  })
  useEffect(() => setConfirmed(false), [impact.data?.token, session.preview_token])
  return (
    <section className="seasonal-section">
      <h2>想好去向，再执行</h2>
      <p>勾选对象，核对动作后确认。收纳不会自动设为不可穿；开始维修会设为暂不可用。</p>
      <form
        id={formId}
        ref={formRef}
        className="seasonal-form"
        onSubmit={form.handleSubmit((values) => {
          if (!confirmed || !picked.length || (exit && (picked.length !== 1 || !impact.data)))
            return
          const changes: Record<string, string> = exit
            ? { exit_reason: choice }
            : choice === 'keep'
              ? { decision: 'keep', decision_reason: values.reason }
              : choice === 'repair'
                ? {}
                : {
                    storage: choice,
                    ...(values.location.trim() ? { location: values.location.trim() } : {}),
                  }
          operation.send(`/seasonal-sessions/${session.id}/actions`, 'POST', {
            items: picked.map((i) => ({
              id: entityId(),
              garment_id: i.garment_id,
              operation: {
                expected_version: i.current!.version,
                action: exit
                  ? 'retire'
                  : choice === 'repair'
                    ? 'repair_start'
                    : choice === 'keep'
                      ? 'decision'
                      : 'storage',
                occurred_on: values.date,
                reason: values.reason,
                changes,
                impact_token: exit ? impact.data!.token : null,
              },
            })),
          })
        })}
      >
        <fieldset disabled={operation.busy} onChange={() => setConfirmed(false)}>
          <legend>1. 选择本轮的单品（最多 20 件）</legend>
          <ActionPicker session={session} selected={selected} onSelect={setSelected} />
          <label>
            2. 明确要执行的动作
            <select {...form.register('choice')}>
              <optgroup label="继续持有">
                {Object.entries(choices)
                  .slice(0, 4)
                  .map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
              </optgroup>
              <optgroup label="退出衣橱">
                {Object.entries(choices)
                  .slice(4)
                  .map(([v, n]) => (
                    <option key={v} value={v}>
                      {n}
                    </option>
                  ))}
              </optgroup>
            </select>
          </label>
          {exit && (
            <p className="seasonal-attention">
              退出需逐件核对全季影响，一次选择一件。退出后保留档案与旧搭配。
            </p>
          )}
          <label>
            实际发生日期
            <input type="date" max={today()} required {...form.register('date')} />
          </label>
          {['stored', 'daily'].includes(choice) && (
            <label>
              收纳位置（选填）
              <input maxLength={120} placeholder="留空保留原位置" {...form.register('location')} />
            </label>
          )}
          <label>
            {choice === 'keep' ? '保留理由（必填）' : '备注（选填）'}
            <textarea
              rows={2}
              maxLength={500}
              required={choice === 'keep'}
              {...form.register('reason')}
            />
          </label>
        </fieldset>
        <div className="seasonal-buttons">
          <Sheet
            title={`确认${choices[choice]}`}
            open={confirming}
            onOpenChange={(open) => {
              if (operation.sending) return
              if (open && !formRef.current?.reportValidity()) return
              setConfirmed(false)
              setConfirming(open)
            }}
            finalFocus={() =>
              triggerRef.current ??
              document.querySelector<HTMLHeadingElement>('[data-seasonal-focus]')
            }
            trigger={
              <Button
                ref={triggerRef}
                disabled={operation.busy || !picked.length || (exit && picked.length !== 1)}
              >
                核对并执行 · {picked.length} 件
              </Button>
            }
          >
            <div className="seasonal-page seasonal-confirm-sheet">
              {operation.error && (
                <p role="alert" className="error">
                  {operation.error.message}。关闭面板可重发原请求或放弃待发操作。
                </p>
              )}
              {exit && selected.length === 1 && (
                <div>
                  {impact.isPending && <p role="status">正在读取全季退出影响…</p>}
                  {impact.isError && <p role="alert">{impact.error.message}</p>}
                  {impact.data && <ExitImpactView impact={impact.data} />}
                  <Button
                    variant="outline"
                    disabled={operation.busy || impact.isFetching}
                    onClick={() => {
                      setConfirmed(false)
                      void impact.refetch()
                    }}
                  >
                    重新读取退出影响
                  </Button>
                </div>
              )}
              <div className="seasonal-confirm">
                <h3>本次处理对象</h3>
                <p>
                  {choices[choice]} · {picked.length} 件 · {form.watch('date')}
                </p>
                <ul>
                  {picked.map((i) => (
                    <li key={i.garment_id}>{i.current!.name ?? '未命名单品'}</li>
                  ))}
                </ul>
                <label className="seasonal-check">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    disabled={
                      operation.busy ||
                      !picked.length ||
                      (exit &&
                        (picked.length !== 1 ||
                          !impact.data ||
                          impact.isFetching ||
                          impact.isError))
                    }
                    onChange={(e) => setConfirmed(e.target.checked)}
                  />
                  我已核对对象与动作，确认现在执行
                </label>
                <p className="muted">
                  已执行动作会立即保存，离开整理不会回滚。每件会单独显示结果。
                </p>
                {picked.some((i) => i.todo) && (
                  <p className="muted">已有待办会保留；完成后请回到核对页清空并保存。</p>
                )}
              </div>
              <SheetFooter>
                <div className="seasonal-buttons seasonal-page">
                  <Button
                    type="submit"
                    form={formId}
                    className={exit ? 'seasonal-danger' : ''}
                    disabled={
                      operation.busy ||
                      !confirmed ||
                      !picked.length ||
                      (exit && (picked.length !== 1 || impact.isFetching || impact.isError))
                    }
                  >
                    确认执行{choices[choice]}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={operation.sending}
                    onClick={() => {
                      setConfirming(false)
                      setConfirmed(false)
                    }}
                  >
                    返回修改
                  </Button>
                </div>
              </SheetFooter>
            </div>
          </Sheet>
          <Button
            variant="outline"
            disabled={operation.busy}
            onClick={() => {
              setSelected([])
              setConfirmed(false)
              form.reset()
            }}
          >
            取消未执行选择
          </Button>
        </div>
      </form>
      <ActionHistory session={session} />
    </section>
  )
}
