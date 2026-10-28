import { LoaderCircle, Sparkles } from 'lucide-react'
import './task-status.css'
import { Button } from '../../components/ui/button'
import type { OutfitController } from './use-outfits'

export function OutfitStatus({
  controller: c,
  compact = false,
}: {
  controller: OutfitController
  compact?: boolean
}) {
  const statusNames: Record<string, string> = {
    queued: '排队中',
    running: '处理中',
    cancel_requested: '正在取消',
    succeeded: '已完成',
    failed: '失败',
    interrupted: '已中断',
    cancelled: '已取消',
  }
  const waiting = c.submitting || c.active
  const cancelling = c.cancel.isPending || c.job?.status === 'cancel_requested'
  const title = c.submitting
    ? '正在提交搭配请求'
    : cancelling
      ? '正在停止本次搭配'
      : !c.job
        ? '正在同步任务状态'
        : c.job.status === 'queued'
          ? '搭配已排队'
          : c.job.kind === 'outfit_adjust'
            ? '正在调整这套搭配'
            : '正在为你搭配'
  const hint = cancelling
    ? '取消请求已发出，等待任务确认。'
    : c.submitting
      ? '正在确认请求，请稍候。'
      : c.job?.status === 'queued'
        ? '轮到后会自动开始，无需重复提交。'
        : '完成后会自动更新，可以先浏览已有穿搭。'
  return (
    <div className="outfit-status">
      {c.error && (
        <p role="alert" className="error">
          {c.error.message}
        </p>
      )}
      {c.pending && !c.submitting && (
        <div className="notice">
          <p>有一项操作尚未确认结果，刷新不会自动重发。</p>
          <Button disabled={c.submitting} onClick={c.resend}>
            重发同一搭配操作
          </Button>
          <Button variant="outline" disabled={c.submitting} onClick={c.discard}>
            放弃待发操作并刷新
          </Button>
        </div>
      )}
      {waiting && (
        <div className="outfit-loading">
          <div className="outfit-loading-icon" aria-hidden="true">
            <LoaderCircle className="outfit-loading-ring" size={40} strokeWidth={1.5} />
            <Sparkles size={17} />
          </div>
          <div className="outfit-loading-copy" role="status" aria-live="polite">
            <strong>{title}</strong>
            <p>{hint}</p>
          </div>
          {c.active && !c.submitting && (
            <Button
              variant="outline"
              className="outfit-cancel"
              disabled={cancelling}
              onClick={() => c.cancel.mutate()}
            >
              {cancelling ? '取消中…' : '请求取消'}
            </Button>
          )}
        </div>
      )}
      {c.notice && <p role="status">{c.notice}</p>}
      {c.job &&
        !waiting &&
        (!compact ||
          c.job.status !== 'succeeded' ||
          c.job.result?.outcome === 'no_match' ||
          c.job.result?.question) && (
          <div className="notice">
            <p>任务状态：{statusNames[c.job.status]}</p>
            {c.job.error && <p role="alert">{c.job.error.message}</p>}
            {c.job.result?.outcome === 'no_match' && (
              <p>{c.job.result.unmet_requirements.join('；')}</p>
            )}
            {c.job.result?.question && <p>{c.job.result.question}</p>}
            {['failed', 'interrupted'].includes(c.job.status) && (
              <>
                <p>请先核对条件；重试可能再次调用模型并计费。</p>
                <Button disabled={c.busy} onClick={c.retry}>
                  显式重试搭配任务
                </Button>
              </>
            )}
          </div>
        )}
    </div>
  )
}
