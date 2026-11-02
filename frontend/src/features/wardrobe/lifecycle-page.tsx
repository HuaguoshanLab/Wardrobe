import { careReturn, seasonalReturn } from './return-context'
import { useEffect, useRef, useState } from 'react'
import { useBlocker, useLocation, useParams } from 'react-router'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '../../components/ui/button'
import { PageHeader } from '../../components/ui/page-header'
import { Sheet } from '../../components/ui/sheet'
import { OperationNotice } from '../../components/ui/operation-notice'
import { useOperation } from '../../lib/use-operation'
import { getGarment } from './api'
import {
  getLifecycle,
  getSubtypes,
  subtypeSchema,
  lifecycleNames,
  type LifecycleAction,
  type LifecycleEvent,
} from './lifecycle-api'
import { draftFor, LifecycleForm, type LifeDraft } from './lifecycle-form'
import { LifecycleTimeline } from './lifecycle-timeline'
import { LifecycleOverview, LifecycleArchive } from './lifecycle-overview'
import './lifecycle.css'
import './organization/organization.css'
import { getExitImpact } from './organization/api'
import { ExitImpactView } from './organization/exit-impact'

export function LifecyclePage() {
  const { id = '' } = useParams()
  const returnState = useLocation().state
  const client = useQueryClient()
  const actionFocus = useRef<HTMLElement | null>(null)
  const subtypeFocus = useRef<HTMLElement | null>(null)
  const query = useQuery({ queryKey: ['garment', id], queryFn: () => getGarment(id) })
  const subtypes = useQuery({ queryKey: ['garment-subtypes'], queryFn: getSubtypes })
  const history = useInfiniteQuery({
    queryKey: ['lifecycle', id],
    initialPageParam: undefined as number | undefined,
    queryFn: ({ pageParam }) => getLifecycle(id, pageParam),
    getNextPageParam: (page) => page.next_cursor ?? undefined,
  })
  const [draft, setDraft] = useState<LifeDraft | null>(null)
  const [dirty, setDirty] = useState(false)
  const [exitAck, setExitAck] = useState(false)
  const impact = useQuery({
    queryKey: ['exit-impact', id],
    queryFn: () => getExitImpact(id),
    enabled: draft?.action === 'retire',
    refetchOnWindowFocus: false,
  })
  useEffect(() => setExitAck(false), [impact.data?.token])
  const [discard, setDiscard] = useState<'editor' | 'subtype' | null>(null)
  const [subtypeName, setSubtypeName] = useState('')
  const [addingSubtype, setAddingSubtype] = useState(false)
  const operation = useOperation(`lifecycle.${id}`, () => {
    setDraft(null)
    setDirty(false)
  })
  const subtypeOperation = useOperation(`subtype.${id}`, (value) => {
    const subtype = subtypeSchema.safeParse(value)
    if (subtype.success) {
      client.setQueryData(['garment-subtypes'], (old: typeof subtypes.data) => [
        ...(old ?? []).filter((s) => s.id !== subtype.data.id),
        subtype.data,
      ])
      setDraft((current) =>
        current?.action === 'profile'
          ? { ...current, changes: { ...current.changes, subtype_id: subtype.data.id } }
          : current,
      )
      if (draft?.action === 'profile') setDirty(true)
    }
    setSubtypeName('')
    setAddingSubtype(false)
  })
  const busy = operation.busy || subtypeOperation.busy
  const blocked = dirty || !!subtypeName || operation.sending || subtypeOperation.sending
  const blocker = useBlocker(blocked)
  useEffect(() => {
    if (!blocked) return
    const handler = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [blocked])
  const item = query.data
  const events = history.data?.pages.flatMap((p) => p.items) ?? []
  const start = (action: LifecycleAction, event?: LifecycleEvent) => {
    if (!item) return
    actionFocus.current = document.activeElement as HTMLElement
    const next = draftFor(item, action, event)
    if (action === 'restore')
      next.related_event_id = history.data?.pages[0].last_exit_event_id ?? null
    setDraft(next)
    setExitAck(false)
    setDirty(false)
  }
  const close = () => {
    if (operation.sending || dirty) setDiscard('editor')
    else setDraft(null)
  }
  const send = () => {
    if (!draft) return
    if (draft.action === 'retire') {
      if (!exitAck || !impact.data || impact.isFetching || impact.isError) return
      operation.send(`/organization/${id}/process`, 'POST', {
        garment_version: impact.data.garment_version,
        impact_token: impact.data.token,
        action: draft.changes.exit_reason ?? 'other',
        occurred_on: draft.occurred_on,
        reason: draft.reason,
      })
      return
    }
    operation.send(`/garments/${id}/lifecycle`, 'POST', {
      expected_version: draft.version,
      action: draft.action,
      occurred_on: draft.occurred_on,
      reason: draft.reason,
      changes: draft.changes,
      related_event_id: draft.related_event_id,
    })
  }
  const lastExit = history.data?.pages[0].last_exit_event_id
  return (
    <section className="lifecycle-page">
      <PageHeader
        title="单品生命周期"
        backTo={careReturn(returnState) ?? seasonalReturn(returnState) ?? `/wardrobe/${id}`}
        backLabel={
          careReturn(returnState)
            ? '返回洗衣与批量管理'
            : seasonalReturn(returnState)
              ? '返回本轮整理'
              : '返回单品'
        }
        backState={returnState}
      />
      {!item ? (
        <p role={query.error ? 'alert' : 'status'}>
          {query.error?.message ?? '正在读取单品…'}
          {query.error && <Button onClick={() => void query.refetch()}>重试</Button>}
        </p>
      ) : (
        <>
          <LifecycleOverview
            item={item}
            subtypes={subtypes.data}
            wear={history.data?.pages[0]}
            busy={busy}
            onAction={start}
          />
          {subtypes.error && (
            <p role="alert">
              子类读取失败。<Button onClick={() => void subtypes.refetch()}>重试读取子类</Button>
            </p>
          )}
          <OperationNotice operation={operation} />
          <OperationNotice operation={subtypeOperation} />
          <section className="panel">
            <div className="lifecycle-section-heading">
              <h2>生命周期记录</h2>
              <span>最近保存优先</span>
            </div>
            {history.isPending && <p role="status">正在读取记录…</p>}
            {history.error && (
              <p role="alert">
                {history.error.message}
                <Button onClick={() => void history.refetch()}>重试记录</Button>
              </p>
            )}
            {history.data && !events.length && (
              <p className="muted">
                还没有记录。从上方补充获得资料，或记录一次收纳、维修，开始留下它的经历。
              </p>
            )}
            <LifecycleTimeline
              events={events}
              subtypes={subtypes.data ?? []}
              busy={busy}
              onCorrect={(event) => start('correct', event)}
            />
            {history.hasNextPage && (
              <Button
                disabled={history.isFetchingNextPage}
                onClick={() => void history.fetchNextPage()}
              >
                加载更早记录
              </Button>
            )}
          </section>
          <LifecycleArchive item={item} busy={busy} canRestore={!!lastExit} onAction={start} />
        </>
      )}
      <Sheet
        title={draft ? lifecycleNames[draft.action] : '生命周期'}
        finalFocus={actionFocus}
        open={!!draft}
        onOpenChange={(open) => {
          if (!open) close()
        }}
        trigger={<button hidden type="button" />}
      >
        {draft && (
          <>
            {draft.action === 'retire' && (
              <>
                {impact.isFetching && <p role="status">正在核对退出影响…</p>}
                {impact.error && <p role="alert">{impact.error.message}</p>}
                {impact.data && <ExitImpactView impact={impact.data} />}
                <Button
                  variant="outline"
                  disabled={operation.sending || impact.isFetching}
                  onClick={async () => {
                    setExitAck(false)
                    const latest = await impact.refetch()
                    if (!latest.isError) operation.discard()
                  }}
                >
                  重新核对退出影响
                </Button>
                <label className="organization-check">
                  <input
                    type="checkbox"
                    checked={exitAck}
                    disabled={!impact.data || impact.isFetching || impact.isError || operation.busy}
                    onChange={(e) => setExitAck(e.target.checked)}
                  />
                  已核对全部季节影响，确认实际退出
                </label>
              </>
            )}
            <LifecycleForm
              draft={draft}
              setDraft={(d) => {
                setDraft(d)
                setDirty(true)
              }}
              subtypes={(subtypes.data ?? []).filter((s) => s.category === item?.category)}
              busy={busy}
              submitDisabled={
                draft.action === 'retire' &&
                (!exitAck || !impact.data || impact.isFetching || impact.isError)
              }
              onSave={send}
              onAddSubtype={() => {
                subtypeFocus.current = document.activeElement as HTMLElement
                setAddingSubtype(true)
              }}
            />
            <OperationNotice operation={operation} />
            {draft.action === 'profile' && subtypes.error && (
              <p role="alert">
                子类读取失败，已有选择会保留。
                <Button variant="outline" onClick={() => void subtypes.refetch()}>
                  重试读取子类
                </Button>
              </p>
            )}
            {(operation.error || operation.pending) && (
              <Button
                variant="outline"
                disabled={operation.sending}
                onClick={async () => {
                  const latest = await query.refetch()
                  if (latest.data && !latest.isError) {
                    operation.discard()
                    setDraft({ ...draft, version: latest.data.version })
                    setDirty(true)
                  }
                }}
              >
                保留输入并读取最新版本
              </Button>
            )}
          </>
        )}
      </Sheet>
      <Sheet
        title="新增子类"
        finalFocus={subtypeFocus}
        open={addingSubtype}
        onOpenChange={(open) => {
          if (!open && (subtypeName || subtypeOperation.sending)) setDiscard('subtype')
          else if (!subtypeOperation.sending) setAddingSubtype(open)
        }}
        trigger={<button hidden type="button" />}
      >
        <form
          className="lifecycle-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (item?.category)
              subtypeOperation.send('/garment-subtypes', 'POST', {
                category: item.category,
                name: subtypeName,
              })
          }}
        >
          <label>
            子类名称
            <input
              required
              maxLength={40}
              disabled={subtypeOperation.busy}
              value={subtypeName}
              onChange={(e) => setSubtypeName(e.target.value)}
            />
          </label>
          <p className="muted">归属于当前品类。创建后自动选中，保存资料才会关联到这件衣服。</p>
          <Button type="submit" disabled={subtypeOperation.busy || !subtypeName.trim()}>
            创建子类
          </Button>
          <OperationNotice operation={subtypeOperation} />
        </form>
      </Sheet>
      <Sheet
        title={operation.sending || subtypeOperation.sending ? '正在保存' : '放弃未保存的修改？'}
        open={!!discard || blocker.state === 'blocked'}
        onOpenChange={(open) => {
          if (!open) {
            setDiscard(null)
            if (blocker.state === 'blocked') blocker.reset()
          }
        }}
        trigger={<button hidden type="button" />}
      >
        <p>
          {operation.sending || subtypeOperation.sending
            ? '请等待保存完成。'
            : '离开会放弃本次未提交输入；结果未确认的请求仍可重发。'}
        </p>
        <Button
          onClick={() => {
            setDiscard(null)
            if (blocker.state === 'blocked') blocker.reset()
          }}
        >
          继续编辑
        </Button>
        <Button
          disabled={operation.sending || subtypeOperation.sending}
          variant="outline"
          onClick={() => {
            if (discard !== 'subtype' || blocker.state === 'blocked') {
              setDraft(null)
              setDirty(false)
            }
            setSubtypeName('')
            setAddingSubtype(false)
            setDiscard(null)
            if (blocker.state === 'blocked') blocker.proceed()
          }}
        >
          放弃修改
        </Button>
      </Sheet>
    </section>
  )
}
