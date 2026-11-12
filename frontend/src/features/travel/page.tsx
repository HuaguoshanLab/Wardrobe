import { useEffect, useRef, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { Luggage, Plus } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Sheet, SheetFooter } from '../../components/ui/sheet'
import { TravelSummary } from './summary'
import { TravelEditor } from './editor'
import { TravelResults } from './results'
import {
  cancelJob,
  forgetOperation,
  getJob,
  getTravel,
  getTravels,
  operation,
  pendingOperation,
  sendOperation,
  terminal,
  type Operation,
} from './api'
import './travel.css'

export function TravelPage() {
  const { planId } = useParams()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [editorVersion, setEditorVersion] = useState(1)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [pending, setPending] = useState(pendingOperation)
  const lock = useRef(false)
  const feedback = useRef<HTMLParagraphElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement | null>(null)
  const list = useInfiniteQuery({
    queryKey: ['travel-list'],
    queryFn: ({ pageParam }) => getTravels(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === 20 ? pages.length * 20 : undefined),
    enabled: !planId,
  })
  const plan = useQuery({
    queryKey: ['travel', planId],
    queryFn: () => getTravel(planId!),
    enabled: !!planId,
  })
  const job = useQuery({
    queryKey: ['travel-job', plan.data?.current_job_id],
    queryFn: () => getJob(plan.data!.current_job_id!),
    enabled: !!plan.data?.current_job_id,
    refetchInterval: (q) => (terminal(q.state.data?.status) ? false : 1500),
  })
  const running = !!plan.data?.current_job_id && (!job.data || !terminal(job.data.status))
  useEffect(() => {
    if (terminal(job.data?.status)) {
      void cache.invalidateQueries({ queryKey: ['travel', planId] })
      void cache.invalidateQueries({ queryKey: ['travel-list'] })
    }
  }, [job.data?.status, cache, planId])
  useEffect(() => {
    setEditing(false)
    setError('')
    setNotice('')
  }, [planId])
  useEffect(() => {
    if (error || notice) feedback.current?.focus()
  }, [error, notice])
  async function execute(op: Operation) {
    if (lock.current) return false
    lock.current = true
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await sendOperation(op)
      setPending(null)
      await cache.invalidateQueries({ queryKey: ['travel'] })
      await cache.invalidateQueries({ queryKey: ['travel-list'] })
      if ('wear_record_id' in result) {
        await cache.invalidateQueries({ queryKey: ['wears'] })
        await cache.invalidateQueries({ queryKey: ['history'] })
        setNotice('已记录到穿着日历。')
      } else if ('job_id' in result) setNotice('已开始规划，可稍后回来查看。')
      else if (op.method !== 'DELETE' && !op.path.endsWith('/packing')) {
        localStorage.removeItem(`wardrobe.travel.draft:${planId ?? 'new'}`)
        setEditing(false)
        if (!planId) navigate(`/collections/travel/${result.id}`)
        setNotice('已保存。')
      }
      return true
    } catch (e) {
      setPending(pendingOperation())
      setError(e instanceof Error ? e.message : '操作失败，请重试')
      return false
    } finally {
      setBusy(false)
      lock.current = false
    }
  }
  const blocked = busy || !!pending
  return (
    <section className="travel-page">
      <Link className="text-link" to={planId ? '/collections/travel' : '/collections'}>
        ← {planId ? '全部旅行计划' : '穿搭记录'}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">TRAVEL CAPSULE</span>
          <h1>{plan.data?.draft.name ?? '旅行胶囊衣橱'}</h1>
          {!planId && <p>少带一些，穿得合适。</p>}
        </div>
        <Luggage aria-hidden="true" size={32} />
      </div>
      {(error || notice) && (
        <p
          tabIndex={-1}
          ref={feedback}
          role={error ? 'alert' : 'status'}
          className={error ? 'error' : 'notice'}
        >
          {error || notice}
        </p>
      )}
      {pending && (
        <div className="notice">
          <h2>上次操作结果尚未确认</h2>
          <p>重发可继续上次操作，不会重复保存或生成。</p>
          <div className="actions">
            <Button disabled={busy} onClick={() => void execute(pending)}>
              重发原操作
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={async () => {
                const result = planId ? await plan.refetch() : await list.refetch()
                if (result.error) {
                  setError('读取失败，上次操作已保留，请重试。')
                  return
                }
                forgetOperation()
                setPending(null)
                setNotice('状态已更新，请核对。')
              }}
            >
              读取状态并结束恢复
            </Button>
          </div>
        </div>
      )}
      {planId && plan.isPending && <p role="status">正在读取计划…</p>}
      {planId && plan.error && (
        <p role="alert">
          {plan.error.message}
          <Button onClick={() => void plan.refetch()}>重试读取计划</Button>
        </p>
      )}
      {!planId && !editing && (
        <>
          <div className="travel-intro panel">
            <h2>安排旅途穿搭</h2>
            <p>规划 1～7 天搭配，整理一份行李清单。</p>
            <Button disabled={blocked} onClick={() => setEditing(true)}>
              <Plus size={18} aria-hidden="true" />
              新建旅行计划
            </Button>
          </div>
          {list.isPending && <p role="status">正在读取旅行计划…</p>}
          {list.error && (
            <p role="alert">
              {list.error.message}
              <Button onClick={() => void list.refetch()}>重试列表</Button>
            </p>
          )}
          {list.data?.pages.flat().length === 0 && (
            <p className="travel-empty">还没有旅行计划，先新建一个吧。</p>
          )}
          <div className="travel-list">
            {list.data?.pages.flat().map((p) => (
              <Link
                className="panel travel-list-card"
                key={p.id}
                to={`/collections/travel/${p.id}`}
              >
                <span className="eyebrow">
                  {p.draft.city.name} · {p.draft.days.length} 天
                </span>
                <h2>{p.draft.name}</h2>
                <p>
                  {p.draft.days[0].date} — {p.draft.days.at(-1)?.date}
                </p>
                <strong>
                  {p.revision
                    ? `${p.packing.length} 件行李 · 已收拾 ${p.packing.filter((i) => i.packed).length} 件`
                    : '已保存条件 · 尚未生成'}
                </strong>
                <span>查看计划 →</span>
              </Link>
            ))}
          </div>
          {list.hasNextPage && (
            <Button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              更多计划
            </Button>
          )}
        </>
      )}
      {editing && (
        <div className="panel">
          <h2>{planId ? '编辑行程条件' : '创建旅行计划'}</h2>
          <TravelEditor
            id={planId ?? 'new'}
            value={plan.data?.draft}
            busy={blocked}
            onClose={() => setEditing(false)}
            onSave={async (data) => {
              await execute(
                operation(
                  `/travel-plans${planId ? `/${planId}` : ''}`,
                  planId ? { ...data, expected_version: editorVersion } : data,
                  planId ? 'PATCH' : 'POST',
                ),
              )
            }}
          />
        </div>
      )}
      {plan.data && !editing && (
        <>
          <TravelSummary draft={plan.data.draft} />
          <div className="travel-actions">
            <Button
              disabled={blocked || running}
              onClick={() =>
                void execute(
                  operation(`/travel-plans/${planId}/generate`, {
                    expected_version: plan.data!.version,
                  }),
                )
              }
            >
              {plan.data.revision ? '重新生成完整计划' : '生成旅行计划'}
            </Button>
            <Button
              variant="outline"
              disabled={blocked || running}
              onClick={() => {
                setEditorVersion(plan.data!.version)
                setEditing(true)
              }}
            >
              编辑行程
            </Button>
            <Button
              variant="outline"
              disabled={blocked || running}
              ref={deleteTrigger}
              onClick={() => setDeleting(true)}
            >
              删除计划
            </Button>
          </div>
          {running && (
            <div role="status" className="notice">
              {job.error ? '正在重新连接，不会重复生成。' : '正在规划或核对行程…'}
              <Button
                variant="outline"
                disabled={busy || job.data?.status === 'cancel_requested'}
                onClick={async () => {
                  setBusy(true)
                  try {
                    await cancelJob(plan.data!.current_job_id!)
                    await job.refetch()
                  } catch (e) {
                    setError(e instanceof Error ? e.message : '取消失败')
                  } finally {
                    setBusy(false)
                  }
                }}
              >
                取消本次任务
              </Button>
            </div>
          )}
          {job.data && ['failed', 'interrupted', 'cancelled'].includes(job.data.status) && (
            <p role="alert" className="notice">
              本次计划未完成：{job.data.error?.message ?? '任务已取消'}
              。原方案已保留，可修改条件后重试。
            </p>
          )}
          <TravelResults
            key={plan.data.id}
            plan={plan.data}
            busy={blocked || running}
            submitting={busy}
            onAction={(action, body) =>
              execute(operation(`/travel-plans/${planId}/${action}`, body))
            }
          />
        </>
      )}
      <Sheet
        finalFocus={deleteTrigger}
        title="删除旅行计划？"
        trigger={<span hidden />}
        open={deleting}
        onOpenChange={(open) => {
          if (!busy) setDeleting(open)
        }}
      >
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <p>删除后，已记录的穿着和图片仍保留。</p>
        <SheetFooter>
          <Button variant="outline" disabled={busy} onClick={() => setDeleting(false)}>
            保留计划
          </Button>
          <Button
            disabled={blocked}
            onClick={async () => {
              if (
                await execute(
                  operation(
                    `/travel-plans/${planId}`,
                    { expected_version: plan.data!.version },
                    'DELETE',
                  ),
                )
              ) {
                setDeleting(false)
                navigate('/collections/travel')
              }
            }}
          >
            {busy ? '正在删除…' : '确认删除计划'}
          </Button>
        </SheetFooter>
      </Sheet>
    </section>
  )
}
