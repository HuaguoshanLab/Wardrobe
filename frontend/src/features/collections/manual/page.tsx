import { useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router'
import { Button } from '../../../components/ui/button'
import { PageHeader } from '../../../components/ui/page-header'
import { Sheet, SheetFooter } from '../../../components/ui/sheet'
import { isPastDay } from '../api'
import { ManualPicker } from './picker'
import { ManualSelection } from './selection'
import { ManualSaveOptions } from './save-options'
import { ManualSaved } from './result'
import { ManualLeaveGuard } from './leave-guard'
import { useManual } from './use-manual'
import './manual.css'

export function ManualPage() {
  const [params] = useSearchParams()
  const parent = params.get('from') || ''
  const date = params.get('date') || ''
  return <ManualEditor key={parent} parent={parent} date={isPastDay(date) ? date : ''} />
}
function ManualEditor({ parent, date }: { parent: string; date: string }) {
  const state = useLocation().state as { manualReturn?: unknown } | null
  const returnTo =
    typeof state?.manualReturn === 'string' &&
    /^\/(collections|wardrobe)(?:\?|$)/.test(state.manualReturn)
      ? state.manualReturn
      : '/collections'
  const m = useManual(parent, date)
  const [picker, setPicker] = useState(false)
  const pickerButton = useRef<HTMLButtonElement>(null)
  const { draft: d, setDraft } = m
  const unavailable = d.items.filter((i) => i.availability === 'unavailable')
  const invalid = d.items.some((i) => i.issue || i.version < 1)
  const allowed =
    d.items.length > 0 &&
    !invalid &&
    (d.mode === 'save'
      ? !unavailable.length
      : isPastDay(d.date) && (!unavailable.length || d.acknowledged))
  const hint = !m.ready
    ? '先读取原搭配'
    : m.pending
      ? '请先确认上次保存的结果'
      : !d.items.length
        ? '先选至少一件衣服'
        : invalid
          ? '请处理失效的单品'
          : d.mode === 'save' && unavailable.length
            ? '请移除暂不可用的衣服'
            : d.mode === 'wear' && !isPastDay(d.date)
              ? '请选择实际穿着日期'
              : d.mode === 'wear' && unavailable.length && !d.acknowledged
                ? '请确认当日确实穿过'
                : d.mode === 'save'
                  ? '保存到搭配历史'
                  : `记入 ${d.date} 的日历`
  return (
    <section className="manual-page subpage">
      <PageHeader
        title={parent ? '修改手动搭配' : '手动搭配'}
        backTo={returnTo}
        backLabel="返回原页面"
      />
      {!m.result && (
        <ManualLeaveGuard
          dirty={d.items.length > 0 || !!m.pending || !!d.notes}
          sending={m.sending}
        />
      )}
      {m.result ? (
        <ManualSaved result={m.result} returnTo={returnTo} />
      ) : (
        <>
          <div className="manual-intro">
            <p>自己选衣，自在搭配。</p>
            <span>草稿自动保留</span>
          </div>
          {parent && <p className="notice">本次保存为新搭配，原收藏和穿着记录保持不变。</p>}
          {!m.ready && <p role="status">正在读取原搭配…</p>}
          {m.error && (
            <div className="manual-recovery" role="alert">
              <p>{m.error}</p>
              <Button onClick={() => void m.loadParent()}>重试读取</Button>
            </div>
          )}
          <form
            className="manual-form"
            onSubmit={(e) => {
              e.preventDefault()
              if (!allowed || m.busy) return
              m.submit({
                mode: d.mode,
                notes: d.mode === 'wear' ? d.notes : '',
                items: d.items.map((i) => ({ garment_id: i.id, expected_version: i.version })),
                parent_revision_id: parent || null,
                ...(d.mode === 'wear'
                  ? { worn_on: d.date, acknowledged_unavailable_ids: unavailable.map((i) => i.id) }
                  : {}),
              })
            }}
          >
            <div className="manual-workspace">
              <ManualSelection
                items={d.items}
                busy={m.busy}
                ready={m.ready}
                buttonRef={pickerButton}
                onOpen={() => setPicker(true)}
                onRefresh={() => void m.refresh()}
                onRemove={(id) =>
                  setDraft((v) => ({
                    ...v,
                    items: v.items.filter((i) => i.id !== id),
                    acknowledged: false,
                  }))
                }
              />
              <ManualSaveOptions
                draft={d}
                setDraft={setDraft}
                disabled={m.busy || !m.ready}
                unavailable={unavailable}
              />
            </div>
            {invalid && (
              <p role="alert" className="error">
                部分衣服已失效或未能读取，请重新核对，或移除后保存。
              </p>
            )}
            {m.saveError && (
              <p role="alert" className="error">
                {m.saveError.message}
              </p>
            )}
            {m.pending && (
              <div className="manual-recovery">
                <strong>
                  {m.sending
                    ? '正在保存这套搭配…'
                    : m.canCorrect
                      ? '衣服信息需要重新核对'
                      : '保存结果还未确认'}
                </strong>
                <p>
                  {m.canCorrect
                    ? '读取最新衣服信息后继续修改，已选衣服、日期和备注会保留。'
                    : '原操作已保留。请重试确认结果，不会重复记录；刷新不会自动提交。'}
                </p>
                <div className="actions">
                  <Button disabled={m.sending || m.refreshing} onClick={m.resend}>
                    重发同一操作
                  </Button>
                  {m.canCorrect && (
                    <Button
                      variant="outline"
                      disabled={m.sending || m.refreshing}
                      onClick={() => void m.refresh()}
                    >
                      读取最新状态并继续修改
                    </Button>
                  )}
                </div>
              </div>
            )}
            <div className="manual-submit-bar">
              <div>
                <strong>{d.items.length ? `${d.items.length} 件单品` : '还未选择衣服'}</strong>
                <small id="manual-submit-help">{hint}</small>
              </div>
              <Button
                type="submit"
                aria-describedby="manual-submit-help"
                disabled={!allowed || m.busy || !m.ready}
              >
                {m.sending ? '正在保存…' : d.mode === 'wear' ? '确认记录穿着' : '保存手动搭配'}
              </Button>
            </div>
          </form>
          <Sheet
            title="选择衣服"
            trigger={<span hidden />}
            open={picker}
            onOpenChange={setPicker}
            finalFocus={pickerButton}
          >
            <ManualPicker
              items={d.items}
              onChange={(items) => setDraft((v) => ({ ...v, items, acknowledged: false }))}
            />
            <SheetFooter>
              <Button onClick={() => setPicker(false)}>完成选择（{d.items.length} 件）</Button>
            </SheetFooter>
          </Sheet>
        </>
      )}
    </section>
  )
}
