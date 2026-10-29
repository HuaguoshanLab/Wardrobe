import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link, useParams } from 'react-router'
import { PageHeader } from '../../../components/ui/page-header'
import { Button } from '../../../components/ui/button'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import { DraftGuard } from '../organization/draft-guard'
import { seasons } from '../inventory/api'
import { getSession, stages, type Stage } from './api'
import { Review } from './review'
import { Actions } from './actions'
import { actionSchema } from './api'
import { z } from 'zod'
import { ArrowRight, RefreshCw, CheckCircle2 } from 'lucide-react'
import { Summary, Targets } from './summary'
import '../organization/organization.css'
import './seasonal.css'

export function SeasonalPage() {
  const { id = '' } = useParams()
  const query = useQuery({
    queryKey: ['seasonal-session', id],
    queryFn: () => getSession(id),
    refetchOnWindowFocus: false,
  })
  const [dirty, setDirty] = useState(false)
  const [epoch, setEpoch] = useState(0)
  const [ackToken, setAckToken] = useState('')
  const [feedback, setFeedback] = useState('')
  const op = useOperation(`seasonal.${id}`, (value, path) => {
    const batch = z.object({ items: z.array(actionSchema) }).safeParse(value)
    setFeedback(
      path.endsWith('/actions') && batch.success
        ? `本次处理：${batch.data.items.filter((a) => a.success).length} 项已执行，${batch.data.items.filter((a) => !a.success).length} 项未执行。详细结果见动作记录。`
        : path.endsWith('/complete')
          ? '本轮总结已保存，实际动作没有重复执行。'
          : '本轮进度已保存。',
    )
    setDirty(false)
    setEpoch((v) => v + 1)
    setAckToken('')
  })
  const s = query.data
  const stepKeys = Object.keys(stages) as Stage[]
  const next = s ? stepKeys[stepKeys.indexOf(s.stage) + 1] : undefined
  const go = (stage: Stage) => {
    if (s)
      op.send(`/seasonal-sessions/${id}/progress`, 'POST', { expected_version: s.version, stage })
  }

  return (
    <div className="seasonal-page">
      <PageHeader
        title={s ? `${seasons[s.season]}季整理` : '换季整理'}
        backTo="/wardrobe/seasonal"
        backLabel="返回整理记录"
      />
      <DraftGuard dirty={dirty} sending={op.sending} />
      <OperationNotice operation={{ ...op, notice: op.notice ? feedback : '' }} />
      {query.isPending && <p role="status">正在读取整理进度…</p>}
      {query.isError && <p role="alert">{query.error.message}</p>}
      {s && (
        <div className={`seasonal-resume ${s.completed_at ? 'is-complete' : ''}`}>
          <div>
            <h2 data-seasonal-focus tabIndex={-1}>
              {s.completed_at ? (
                <>
                  <CheckCircle2 size={20} aria-hidden="true" /> 这一季的整理记录
                </>
              ) : (
                <>
                  已核对 <strong>{s.preview.reviewed}</strong> / {s.preview.total} 件
                </>
              )}
            </h2>
            <p>
              {s.completed_at
                ? '历史总结 · 后续变化不会改写本轮记录'
                : `${s.items.filter((i) => i.stale).length} 件资料已变化 · ${s.items.filter((i) => i.todo).length} 件有待办`}
            </p>
            {!s.completed_at && (
              <progress
                aria-label="单品核对进度"
                value={s.preview.reviewed}
                max={Math.max(s.preview.total, 1)}
              />
            )}
          </div>
          {!s.completed_at && (
            <Button
              variant="outline"
              disabled={query.isFetching || op.busy || dirty}
              onClick={() => {
                setAckToken('')
                void query.refetch()
              }}
            >
              <RefreshCw size={16} aria-hidden="true" />
              读取最新状态
            </Button>
          )}
        </div>
      )}
      {query.isError && (
        <Button variant="outline" onClick={() => void query.refetch()}>
          重新读取整理进度
        </Button>
      )}
      {s && (
        <>
          {!s.completed_at && (
            <nav className="seasonal-steps" aria-label="整理步骤">
              {Object.entries(stages).map(([key, label], index) => (
                <button
                  key={key}
                  aria-current={s.stage === key ? 'step' : undefined}
                  disabled={dirty || op.busy || s.stage === key}
                  onClick={() => go(key as Stage)}
                >
                  <span>{index + 1}</span>
                  {label}
                </button>
              ))}
            </nav>
          )}
          {dirty && (
            <p role="status" className="muted">
              先保存或取消当前输入，再切换步骤。
            </p>
          )}
          <div key={epoch}>
            {!s.completed_at && s.stage === 'review' && (
              <Review session={s} operation={op} onDirty={setDirty} />
            )}
            {!s.completed_at && s.stage === 'targets' && <Targets session={s} operation={op} />}
            {!s.completed_at && s.stage === 'actions' && (
              <Actions session={s} operation={op} onDirty={setDirty} />
            )}
            {(s.completed_at || s.stage === 'summary') && (
              <Summary
                session={s}
                operation={op}
                acknowledged={ackToken === s.preview_token && !!ackToken}
                onAcknowledge={(v) => setAckToken(v ? s.preview_token : '')}
              />
            )}
          </div>
          {!s.completed_at && next && (
            <div className="seasonal-next">
              <div>
                <strong>下一步 · {stages[next]}</strong>
                <p>仅切换步骤，已保存进度保留。</p>
              </div>
              <Button disabled={dirty || op.busy} onClick={() => go(next)}>
                继续：{stages[next]}
                <ArrowRight size={16} aria-hidden="true" />
              </Button>
            </div>
          )}
          {!s.completed_at && (
            <p className="seasonal-pause">
              <Link className="text-link" to="/wardrobe/seasonal">
                暂停整理，稍后继续
              </Link>
              <span>已保存进度保留 · 已执行动作不回滚</span>
            </p>
          )}
        </>
      )}
    </div>
  )
}
