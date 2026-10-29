import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { Button } from '../../../components/ui/button'
import { PageHeader } from '../../../components/ui/page-header'
import { Sheet } from '../../../components/ui/sheet'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import { getGarment, type Garment } from '../api'
import { getDecisions, type Candidate } from './api'
import { DraftGuard } from './draft-guard'
import { ProcessForm } from './process-form'
import { DecisionChoices } from './decision-choices'
import { decisionFilters } from './decision-list'
import './organization.css'

export function DecisionPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const key = params.get('reason') ?? 'manual'
  const garment = useQuery({ queryKey: ['garment', id], queryFn: () => getGarment(id) })
  const decisions = useQuery({
    queryKey: ['organization-garment', id],
    queryFn: () => getDecisions(id),
  })
  const error = garment.error ?? decisions.error
  if (!garment.data || !decisions.data)
    return (
      <section className="organization-page">
        <PageHeader
          backLabel="返回整理清单"
          title="整理这件衣服"
          backTo="/wardrobe/organization?tab=decisions"
        />
        <p role={error ? 'alert' : 'status'}>{error?.message ?? '正在读取单品与决定…'}</p>
        {error && (
          <Button
            onClick={() => {
              void garment.refetch()
              void decisions.refetch()
            }}
          >
            重新读取
          </Button>
        )}
      </section>
    )
  const candidate = decisions.data.candidates.find((c) => c.reason_key === key)
  return (
    <DecisionEditor
      key={`${id}:${key}`}
      item={garment.data}
      candidate={candidate}
      reasonKey={key}
    />
  )
}
function DecisionEditor({
  item,
  candidate,
  reasonKey,
}: {
  item: Garment
  candidate?: Candidate
  reasonKey: string
}) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const filter = Object.hasOwn(decisionFilters, params.get('state') ?? '')
    ? params.get('state')!
    : 'active'
  const returnTo = `/wardrobe/organization?tab=decisions&state=${filter}`
  const [saved, setSaved] = useState(false)
  const operation = useOperation(`organization-decision.${item.id}.${reasonKey}`, () => {
    setDirty(false)
    setSaved(true)
  })
  const pending = operation.pending?.body
  const recovered =
    pending && typeof pending === 'object' && !Array.isArray(pending) ? pending : null
  const [note, setNote] = useState(
    typeof recovered?.note === 'string' ? recovered.note : (candidate?.note ?? ''),
  )
  const [state, setState] = useState(
    typeof recovered?.state === 'string'
      ? recovered.state
      : ['observe', 'pending', 'keep'].includes(candidate?.state ?? '')
        ? candidate!.state
        : 'observe',
  )
  const [versions, setVersions] = useState({
    garment_version:
      typeof recovered?.garment_version === 'number' ? recovered.garment_version : item.version,
    expected_version:
      typeof recovered?.expected_version === 'number'
        ? recovered.expected_version
        : (candidate?.decision_version ?? 0),
  })
  const [dirty, setDirty] = useState(!!operation.pending)
  const processFocus = useRef<HTMLButtonElement | null>(null)
  const [processing, setProcessing] = useState(
    () => !!localStorage.getItem(`wardrobe.organization-process.${item.id}.pending`),
  )
  const [processDirty, setProcessDirty] = useState(processing)
  const [sending, setSending] = useState(false)
  const [discard, setDiscard] = useState(false)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  useEffect(() => {
    if (saved) navigate(returnTo, { replace: true })
  }, [saved, navigate, returnTo])
  const unavailable = item.is_demo || item.ownership === 'retired'
  return (
    <section className="organization-page">
      <PageHeader title="整理这件衣服" backTo={returnTo} backLabel="返回观察与处理" />
      <article className="organization-card organization-item">
        <img src={item.image_url} alt="" />
        <div>
          <h2>{item.name ?? '未命名单品'}</h2>
          <Link
            className="text-link"
            to={`/wardrobe/${item.id}`}
            state={{
              organizationReturn: `/wardrobe/organization/garments/${item.id}?${new URLSearchParams({ reason: reasonKey, state: filter })}`,
            }}
          >
            查看单品资料
          </Link>
        </div>
      </article>
      <div className="organization-evidence">
        <span className="organization-kicker">本次整理依据</span>
        <p>{candidate?.reason ?? '用户主动整理；按你的实际需要作决定。'}</p>
      </div>
      {unavailable && (
        <p className="notice">
          {item.is_demo
            ? '示例单品不参与实际整理。'
            : '这件衣服已归档，整理决定仅供查看；误退出可到生命周期撤销。'}
        </p>
      )}
      {candidate && !candidate.current && reasonKey !== 'manual' && (
        <p className="notice">原建议依据已变化；已有决定保留，可重新评估。</p>
      )}
      {item.lifecycle.decision === 'keep' && candidate?.state !== 'keep' && (
        <p className="notice">
          这件衣服已有保留决定。新问题仅供复核，保存新的整理决定才会改变状态。
        </p>
      )}
      <form
        className="organization-form"
        onSubmit={(e) => {
          e.preventDefault()
          operation.send(`/organization/${item.id}/decision`, 'POST', {
            ...versions,
            reason_key: reasonKey,
            note,
            state,
          })
        }}
      >
        <fieldset
          disabled={operation.busy || reading || unavailable}
          onChange={() => setDirty(true)}
        >
          <legend>这件衣服，你想怎么安排？</legend>
          <DecisionChoices value={state} onChange={setState} />
          <label>
            决定原因
            <span className="muted">
              {state === 'keep' || state === 'pending'
                ? '请留下一句理由，方便以后回看。'
                : '可选，记下下次需要核对的事。'}
            </span>
            <textarea
              aria-label="决定原因"
              required={state === 'keep' || state === 'pending'}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
        </fieldset>
        <p className="muted">
          保留会抑制同一原因的重复建议，真实超额数仍保留；待处理也仍是你的库存。
        </p>
        <OperationNotice operation={operation} />
        {error && <p role="alert">{error}</p>}
        {(operation.error || operation.pending) && (
          <Button
            disabled={operation.sending || reading}
            variant="outline"
            onClick={async () => {
              setReading(true)
              try {
                const [g, d] = await Promise.all([getGarment(item.id), getDecisions(item.id)])
                operation.discard()
                setVersions({
                  garment_version: g.version,
                  expected_version:
                    d.candidates.find((c) => c.reason_key === reasonKey)?.decision_version ?? 0,
                })
                setDirty(true)
              } catch (e) {
                setError(e instanceof Error ? e.message : '读取失败')
              } finally {
                setReading(false)
              }
            }}
          >
            保留输入并重新核对版本
          </Button>
        )}
        <Button type="submit" disabled={operation.busy || reading || unavailable}>
          保存整理决定
        </Button>
      </form>
      <section className="organization-card organization-process-entry">
        <h3>已经确定实际处理方式？</h3>
        <p className="muted">
          维修 / 改衣会记录生命周期；转赠、出售、回收和丢弃需要先核对全部季节影响，再单独确认。
        </p>
        <Button
          variant="outline"
          disabled={operation.busy || unavailable || dirty}
          onClick={(e) => {
            processFocus.current = e.currentTarget
            setProcessing(true)
          }}
        >
          执行实际处理
        </Button>
        {dirty && <p className="muted">请先保存当前决定，再执行实际处理。</p>}
      </section>
      <Sheet
        title="实际处理"
        finalFocus={processFocus}
        open={processing}
        trigger={<button hidden type="button" />}
        onOpenChange={(open) => {
          if (!open && (processDirty || sending)) setDiscard(true)
          else setProcessing(open)
        }}
      >
        {processing && (
          <ProcessForm
            item={item}
            onDirty={() => setProcessDirty(true)}
            onSending={setSending}
            onDone={() => {
              setProcessing(false)
              setProcessDirty(false)
              setSaved(true)
            }}
          />
        )}
      </Sheet>
      <Sheet
        title={sending ? '正在保存' : '放弃处理输入？'}
        open={discard}
        trigger={<button hidden type="button" />}
        onOpenChange={setDiscard}
      >
        <p>尚未确认的处理不会执行；未确认结果的原请求可恢复重发。</p>
        <Button onClick={() => setDiscard(false)}>继续填写</Button>
        <Button
          variant="outline"
          disabled={sending}
          onClick={() => {
            setDiscard(false)
            setProcessing(false)
            setProcessDirty(false)
          }}
        >
          放弃处理输入
        </Button>
      </Sheet>
      <DraftGuard
        dirty={(dirty || processDirty) && !saved}
        sending={operation.sending || sending}
      />
    </section>
  )
}
