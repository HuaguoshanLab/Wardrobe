import { useEffect, useState } from 'react'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from 'react-router'
import { Button } from '../../components/ui/button'
import { Sheet } from '../../components/ui/sheet'
import { useOperation } from '../../lib/use-operation'
import { cancelJob, getJob, getReference, getReferences, terminal } from './api'
import { ReferenceUpload } from './upload'
import { ReferenceEditor } from './editor'
import { ReferenceResults } from './results'
import './reference.css'

export function ReferencePage() {
  const { refId } = useParams()
  const navigate = useNavigate()
  const cache = useQueryClient()
  const [deleting, setDeleting] = useState(false)
  const [analyzing, setAnalyzing] = useState(false)
  const [editorKey, setEditorKey] = useState(0)
  const [dirty, setDirty] = useState(false)
  const [cancelError, setCancelError] = useState('')
  const [cancelling, setCancelling] = useState(false)
  const reference = useQuery({
    queryKey: ['reference', refId],
    queryFn: () => getReference(refId!),
    enabled: !!refId,
  })
  const list = useInfiniteQuery({
    queryKey: ['references'],
    queryFn: ({ pageParam }) => getReferences(pageParam),
    initialPageParam: 0,
    getNextPageParam: (last, pages) => (last.length === 20 ? pages.length * 20 : undefined),
    enabled: !refId,
  })
  const job = useQuery({
    queryKey: ['reference-job', reference.data?.current_job_id],
    queryFn: () => getJob(reference.data!.current_job_id!),
    enabled: !!reference.data?.current_job_id,
    refetchInterval: (q) => (terminal(q.state.data?.status) ? false : 1500),
  })
  const running = !!reference.data?.current_job_id && !terminal(job.data?.status)
  useEffect(() => {
    if (terminal(job.data?.status)) void cache.invalidateQueries({ queryKey: ['reference', refId] })
  }, [job.data?.status, cache, refId])
  useEffect(() => {
    setDirty(!!(refId && localStorage.getItem(`wardrobe.reference.draft:${refId}`)))
    setAnalyzing(false)
    setDeleting(false)
  }, [refId])
  const op = useOperation('reference', (_value, _path, method) => {
    setAnalyzing(false)
    if (method === 'PATCH') {
      localStorage.removeItem(`wardrobe.reference.draft:${refId}`)
      setEditorKey((k) => k + 1)
      setDirty(false)
    }
    if (method === 'DELETE') {
      setDeleting(false)
      navigate('/collections/reference')
    }
  })
  const row = reference.data
  const blocked = op.busy || running || cancelling
  const version = { expected_version: row?.version ?? 1 }
  return (
    <section className="reference-page">
      <Link className="text-link" to={refId ? '/collections/reference' : '/collections'}>
        ← {refId ? '全部参考图' : '穿搭记录'}
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">OUTFIT REFERENCE</span>
          <h1>参考图搭配</h1>
          <p>借鉴喜欢的穿搭，用自己的衣服接近它。</p>
        </div>
      </div>
      {op.error && (
        <p role="alert" className="error">
          {op.error.message}
        </p>
      )}
      {op.notice && <p role="status">{op.notice}</p>}
      {op.pending && (
        <div className="notice">
          <p>上次操作结果待确认，重发不会重复调用。</p>
          <div className="actions">
            <Button disabled={op.sending} onClick={op.resend}>
              重发原操作
            </Button>
            <Button
              variant="outline"
              disabled={op.sending}
              onClick={async () => {
                const result = refId ? await reference.refetch() : await list.refetch()
                if (!result.error) op.discard()
              }}
            >
              读取状态并结束恢复
            </Button>
          </div>
        </div>
      )}
      {!refId && (
        <>
          <ReferenceUpload />
          {list.isPending && <p role="status">正在读取参考图…</p>}
          {list.error && (
            <p role="alert">
              {list.error.message}
              <Button onClick={() => void list.refetch()}>重试列表</Button>
            </p>
          )}
          {list.data?.pages.flat().length === 0 && <p>还没有参考图。</p>}
          <div className="reference-list">
            {list.data?.pages.flat().map((r) => (
              <Link className="panel" key={r.id} to={`/collections/reference/${r.id}`}>
                <img src={r.image_url} alt="已保存的参考图" loading="lazy" />
                <strong>
                  {r.confirmed ? '线索已确认' : r.analysis ? '待核对线索' : '尚未分析'}
                </strong>
                <span>
                  {r.revision_ids.length ? `${r.revision_ids.length}套近似搭配` : '查看参考图 →'}
                </span>
              </Link>
            ))}
          </div>
          {list.hasNextPage && (
            <Button disabled={list.isFetchingNextPage} onClick={() => void list.fetchNextPage()}>
              更多参考图
            </Button>
          )}
        </>
      )}
      {refId && reference.isPending && <p role="status">正在读取参考记录…</p>}
      {refId && reference.error && (
        <p role="alert">
          {reference.error.message}
          <Button onClick={() => void reference.refetch()}>重试读取</Button>
        </p>
      )}
      {row && (
        <>
          <img className="reference-photo" src={row.image_url} alt="本次穿搭参考图" />
          <p>1 上传 → 2 分析 → 3 核对线索 → 4 生成</p>
          {row.provider_mode === 'fake' && (
            <p className="notice">当前为模拟结果，不代表真实图片分析效果。</p>
          )}
          <div className="actions">
            <Button disabled={blocked || dirty} onClick={() => setAnalyzing(true)}>
              {row.analysis ? '重新分析参考图' : '分析参考图'}
            </Button>
            <Button variant="outline" disabled={blocked || dirty} onClick={() => setDeleting(true)}>
              删除参考记录
            </Button>
          </div>
          {running && (
            <div role="status" className="notice">
              <p>
                {job.error
                  ? '连接中断，正在恢复任务状态，不会重新调用。'
                  : '正在处理，可离开后回来查看。'}
              </p>
              <Button
                variant="outline"
                disabled={cancelling || job.data?.status === 'cancel_requested'}
                onClick={async () => {
                  setCancelling(true)
                  setCancelError('')
                  try {
                    await cancelJob(row.current_job_id!)
                    await job.refetch()
                  } catch (e) {
                    setCancelError(e instanceof Error ? e.message : '取消失败')
                  } finally {
                    setCancelling(false)
                  }
                }}
              >
                取消任务
              </Button>
            </div>
          )}
          {cancelError && <p role="alert">{cancelError}</p>}
          {job.data?.error && (
            <p role="alert" className="error">
              {job.data.error.message}。可重新分析或生成；新操作可能再次计费。
            </p>
          )}
          {job.data?.status === 'cancelled' && <p role="status">本次任务已取消，原结果保留。</p>}
          {row.analysis?.warnings.map((w, i) => (
            <p className="notice" key={i}>
              {w}
            </p>
          ))}
          {row.analysis && (
            <ReferenceEditor
              key={`${row.id}:${row.version}:${editorKey}`}
              value={row}
              busy={blocked}
              onDirty={setDirty}
              onSave={(clues, expected_version) =>
                op.send(`/references/${row.id}`, 'PATCH', { clues, expected_version })
              }
            />
          )}
          {row.confirmed && (
            <section className="panel">
              <h2>用衣橱接近这套穿搭</h2>
              <p>仅发送已确认线索与衣橱属性。最多三套，缺项会说明；确认线索不会自动生成。</p>
              <Button
                disabled={blocked || dirty || !row.clues.length}
                onClick={() => op.send(`/references/${row.id}/generate`, 'POST', version)}
              >
                {row.revision_ids.length ? '重新生成近似搭配' : '生成近似搭配'}
              </Button>
              {dirty && <p>请先确认修改后的线索。</p>}
            </section>
          )}
          {job.data?.status === 'succeeded' && job.data.result?.no_match && (
            <p className="notice">没有找到近似方案。可以调整参考线索，或补齐衣橱属性后再试。</p>
          )}
          <ReferenceResults ids={row.revision_ids} />
        </>
      )}
      <Sheet
        title="分析这张参考图？"
        trigger={<span hidden />}
        open={analyzing}
        onOpenChange={(v) => {
          if (!op.sending) setAnalyzing(v)
        }}
      >
        <p>
          将去除元数据的参考图发送到已配置的图片分析服务。只分析可见服饰，不识别人物身份或体型。重新分析会重置已确认线索，旧搭配仍保留。
        </p>
        <Button
          disabled={blocked}
          onClick={() => op.send(`/references/${refId}/analyze`, 'POST', version)}
        >
          确认分析
        </Button>
      </Sheet>
      <Sheet
        title="删除参考记录？"
        trigger={<span hidden />}
        open={deleting}
        onOpenChange={(v) => {
          if (!op.sending) setDeleting(v)
        }}
      >
        <p>删除后不能再打开这张参考图。已保存搭配、原件和备份中的副本仍保留，不是永久擦除照片。</p>
        <Button
          disabled={blocked}
          onClick={() => op.send(`/references/${refId}`, 'DELETE', version)}
        >
          确认删除参考记录
        </Button>
      </Sheet>
    </section>
  )
}
