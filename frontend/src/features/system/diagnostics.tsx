import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { useQuery } from '@tanstack/react-query'
import { FlaskConical, Play, RefreshCcw } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { getCapabilities, inputSchema } from './api'
import { useDiagnostic } from './use-diagnostic'

const labels: Record<string, string> = {
  queued: '排队中',
  running: '运行中',
  cancel_requested: '正在取消',
  succeeded: '已完成',
  failed: '失败',
  interrupted: '已中断',
  cancelled: '已取消',
}

export function Diagnostics() {
  const capability = useQuery({ queryKey: ['capabilities'], queryFn: getCapabilities })
  const task = useDiagnostic()
  const form = useForm({
    resolver: zodResolver(inputSchema),
    defaultValues: { message: '验证基础任务流程' },
  })
  return (
    <section className="panel diagnostic">
      <div className="section-title">
        <FlaskConical size={20} />
        <h2>基础环境诊断</h2>
        <span className="badge">FAKE · 模拟</span>
      </div>
      <p className="muted">
        仅验证 API → PostgreSQL → Worker → LangGraph → SSE，不调用云端模型，也不生成穿搭。
      </p>
      <form onSubmit={form.handleSubmit(({ message }) => task.run(message))}>
        <label htmlFor="message">诊断说明</label>
        <input
          id="message"
          {...form.register('message')}
          disabled={task.pending || task.unresolved}
        />
        {form.formState.errors.message && <p role="alert">请输入 1–200 个字符。</p>}
        <div className="actions">
          <Button
            type="submit"
            disabled={task.pending || task.unresolved || capability.data?.provider_mode !== 'fake'}
          >
            <Play size={15} />
            运行模拟任务
          </Button>
          {task.unresolved && (
            <Button type="button" variant="outline" onClick={task.resend} disabled={task.pending}>
              重发同一操作
            </Button>
          )}
          {task.job && ['queued', 'running'].includes(task.job.status) && (
            <Button
              type="button"
              variant="outline"
              onClick={() => task.cancel.mutate()}
              disabled={task.cancel.isPending}
            >
              取消任务
            </Button>
          )}
          {task.job && ['failed', 'interrupted'].includes(task.job.status) && (
            <Button type="button" variant="outline" onClick={task.retry} disabled={task.pending}>
              <RefreshCcw size={15} />
              显式重试
            </Button>
          )}
        </div>
      </form>
      {task.error && (
        <p className="error" role="alert">
          {task.error.message}
        </p>
      )}
      {task.job && (
        <div className="task-result" aria-live="polite">
          <strong>任务状态：{labels[task.job.status]}</strong>
          <p>
            {task.job.result?.message ??
              task.job.error?.message ??
              task.streamMessage ??
              '等待任务事件'}
          </p>
          <small>任务 ID：{task.job.id}</small>
        </div>
      )}
      <p className="footnote">刷新只恢复已有任务。网络失败时重发会沿用原操作键。</p>
    </section>
  )
}
