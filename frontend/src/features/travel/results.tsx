import { useRef, useState } from 'react'
import { useQuery, useInfiniteQuery } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { Sheet, SheetFooter } from '../../components/ui/sheet'
import { GarmentImage, getTaxonomy } from '../wardrobe'
import { TravelPacking } from './packing'
import { getRevisions, today, type Travel, type TravelRevision } from './api'

function Weather({ value }: { value: Record<string, unknown> }) {
  if (value.source === 'unknown') return <p>天气未知 · 出发前请核对</p>
  return (
    <div>
      <p>
        {value.source === 'manual' ? '手填天气' : '对应日期预报'} · {String(value.condition)} ·{' '}
        {value.temperature_c != null
          ? `${value.temperature_c}℃`
          : `${value.minimum_c}～${value.maximum_c}℃`}
      </p>
      {value.fetched_at != null && (
        <small>
          预报读取于 {new Date(String(value.fetched_at)).toLocaleString('zh-CN')}（生成时）
        </small>
      )}
      {Array.isArray(value.attribution) && (
        <small>{value.attribution.map(String).join(' · ')}</small>
      )}
    </div>
  )
}
export function TravelResults({
  plan,
  busy,
  submitting,
  onAction,
}: {
  plan: Travel
  busy: boolean
  submitting: boolean
  onAction: (action: string, body: object) => Promise<boolean>
}) {
  const lastAdjust = useRef<string | null>(null)
  const actionTrigger = useRef<HTMLButtonElement | null>(null)
  const [adjust, setAdjust] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [actionError, setActionError] = useState('')
  const [wear, setWear] = useState<string | null>(null)
  const [history, setHistory] = useState(false)
  const [selected, setSelected] = useState<TravelRevision | null>(null)
  const revisions = useInfiniteQuery({
    queryKey: ['travel-history', plan.id, plan.revision?.id],
    queryFn: ({ pageParam }) => getRevisions(plan.id, pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === 20 ? pages.length * 20 : undefined),
    enabled: history,
  })
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const revision = selected ?? plan.revision
  if (!revision) return <p className="muted">点击生成，安排每日搭配与行李。</p>
  const changed = JSON.stringify(plan.draft) !== JSON.stringify(plan.revision?.request)
  return (
    <>
      <div className="travel-summary panel">
        <h2>
          第 {revision.number} 版 · {revision.days.length} 天
        </h2>
        <p>
          {revision.request.city.name} ·{' '}
          {revision.provider_mode === 'fake' ? '模拟生成' : 'AI 规划'}
        </p>
        {!selected && changed && <p className="notice">条件已更新，请重新生成计划。</p>}
        {revision.warnings.map((w) => (
          <p className="notice" key={w}>
            {w}
          </p>
        ))}
        <Button variant="outline" onClick={() => setHistory((v) => !v)} aria-expanded={history}>
          历史版本
        </Button>
        {history && (
          <div className="travel-fields">
            {revisions.isPending && <p>正在读取历史…</p>}
            {revisions.error && <Button onClick={() => void revisions.refetch()}>重试历史</Button>}
            {revisions.data?.pages.flat().map((r) => (
              <Button
                key={r.id}
                variant="outline"
                onClick={() => setSelected(r.id === plan.revision?.id ? null : r)}
              >
                查看第 {r.number} 版{r.id === revision.id ? ' · 正在查看' : ''}
              </Button>
            ))}
            {revisions.hasNextPage && (
              <Button
                disabled={revisions.isFetchingNextPage}
                onClick={() => void revisions.fetchNextPage()}
              >
                更多历史版本
              </Button>
            )}
          </div>
        )}
        {selected && (
          <p role="status">
            历史版本 · 只读
            <Button onClick={() => setSelected(null)}>回到当前版本</Button>
          </p>
        )}
      </div>
      <nav className="travel-jumps" aria-label="行程快捷导航">
        <Button
          variant="outline"
          onClick={() => {
            const target = document.getElementById('travel-days')
            target?.focus()
            target?.scrollIntoView({ block: 'start' })
          }}
        >
          每日搭配 · {revision.days.length} 天
        </Button>
        {!selected && (
          <Button
            variant="outline"
            onClick={() => {
              const target = document.getElementById('travel-packing')
              target?.focus()
              target?.scrollIntoView({ block: 'start' })
            }}
          >
            行李清单 · {plan.packing.length} 件
          </Button>
        )}
      </nav>
      <div className="travel-days" id="travel-days" tabIndex={-1}>
        {revision.days.map((day, i) => (
          <article className="panel travel-day" key={day.date}>
            <div className="travel-day-heading">
              <span className="eyebrow">DAY {String(i + 1).padStart(2, '0')}</span>
              <h2>
                {day.date} · {taxonomy.data?.fields.occasion_codes?.[day.occasion] ?? day.occasion}
              </h2>
            </div>
            <Weather value={day.weather} />
            <div className="travel-outfit">
              {day.items.map((item) => (
                <div key={item.item_id}>
                  {item.image_url && (
                    <GarmentImage
                      src={item.image_url}
                      alt={String(item.attributes.name ?? '旅行搭配单品')}
                    />
                  )}
                  <span>
                    {String(
                      item.attributes.name ??
                        taxonomy.data?.fields.category?.[item.slot] ??
                        '未命名单品',
                    )}
                  </span>
                </div>
              ))}
            </div>
            {day.warnings.length > 0 && (
              <details>
                <summary>穿搭提示 · {day.warnings.length} 项</summary>
                {day.warnings.map((w) => (
                  <p key={w}>{w}</p>
                ))}
              </details>
            )}
            {!selected && (
              <div className="actions">
                <Button
                  variant="outline"
                  disabled={busy || changed}
                  onClick={(event) => {
                    actionTrigger.current = event.currentTarget
                    setActionError('')
                    if (lastAdjust.current !== day.date) setMessage('')
                    lastAdjust.current = day.date
                    setAdjust(day.date)
                  }}
                >
                  调整这一天
                </Button>
                <Button
                  variant="outline"
                  disabled={busy || day.date > today()}
                  onClick={(event) => {
                    actionTrigger.current = event.currentTarget
                    setActionError('')
                    setWear(day.date)
                  }}
                >
                  确认这天穿过
                </Button>
                {day.date > today() && <small>未来日期不可记录</small>}
              </div>
            )}
          </article>
        ))}
      </div>
      {!selected && <TravelPacking plan={plan} busy={busy} onAction={onAction} />}
      <Sheet
        finalFocus={actionTrigger}
        title="只调整这一天"
        trigger={<span hidden />}
        open={!!adjust}
        onOpenChange={(open) => {
          if (!open && !submitting) setAdjust(null)
        }}
      >
        <p>{adjust} · 只改当天搭配，并更新行李清单。</p>
        <label>
          这一天的调整要求
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            maxLength={1000}
            placeholder="例如：这天需要更正式一些"
          />
        </label>
        {actionError && (
          <p role="alert" className="error">
            {actionError}
          </p>
        )}
        <SheetFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => {
              setAdjust(null)
              setWear(null)
            }}
          >
            暂不操作
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (
                await onAction('generate', {
                  expected_version: plan.version,
                  adjust_date: adjust,
                  message,
                })
              )
                setAdjust(null)
              else setActionError('提交未完成。请关闭面板恢复操作，填写内容已保留。')
            }}
          >
            {busy ? '正在提交…' : '确认调整这一天'}
          </Button>
        </SheetFooter>
      </Sheet>
      <Sheet
        finalFocus={actionTrigger}
        title="确认实际穿着"
        trigger={<span hidden />}
        open={!!wear}
        onOpenChange={(open) => {
          if (!open && !submitting) setWear(null)
        }}
      >
        <p>确认在 {wear} 穿过这套搭配？将记录到穿着日历。</p>
        {actionError && (
          <p role="alert" className="error">
            {actionError}
          </p>
        )}
        <SheetFooter>
          <Button
            variant="outline"
            disabled={submitting}
            onClick={() => {
              setAdjust(null)
              setWear(null)
            }}
          >
            暂不操作
          </Button>
          <Button
            disabled={busy}
            onClick={async () => {
              if (await onAction('wear', { revision_id: revision.id, day: wear, notes: '' }))
                setWear(null)
              else setActionError('保存未完成，请关闭面板恢复操作。')
            }}
          >
            {busy ? '正在保存…' : '确认并记录穿着'}
          </Button>
        </SheetFooter>
      </Sheet>
    </>
  )
}
