import { useEffect, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { PageHeader } from '../../../components/ui/page-header'
import { Button } from '../../../components/ui/button'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import { getConfigs } from '../inventory/api'
import { getSupply, supplyInputSchema, seasonLabel, type SupplyInput, type Supply } from './api'
import { DraftGuard } from './draft-guard'
import './organization.css'

export function SupplyEditorPage() {
  const { id = '' } = useParams()
  const [params] = useSearchParams()
  const isNew = params.get('new') === '1'
  const query = useQuery({
    queryKey: ['supply-plan', id],
    queryFn: () => getSupply(id),
    enabled: !isNew,
  })
  if (!isNew && !query.data)
    return (
      <section className="organization-page">
        <PageHeader backLabel="返回整理清单" title="补充计划" backTo="/wardrobe/organization" />
        <p role={query.error ? 'alert' : 'status'}>{query.error?.message ?? '正在读取计划…'}</p>
        {query.error && <Button onClick={() => void query.refetch()}>重新读取</Button>}
      </section>
    )
  return <SupplyEditor key={id} id={id} initial={query.data} />
}
function SupplyEditor({ id, initial }: { id: string; initial?: Supply }) {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const [saved, setSaved] = useState(false)
  const operation = useOperation(`supply.${id}`, () => {
    setDirty(false)
    setSaved(true)
  })
  const [draft, setDraft] = useState<SupplyInput>(() => {
    const pending = supplyInputSchema.safeParse(operation.pending?.body)
    return pending.success
      ? pending.data
      : {
          expected_version: initial?.version ?? 0,
          name: initial?.name ?? params.get('name') ?? '',
          quantity:
            initial?.quantity ?? Math.max(1, Math.min(10000, Number(params.get('quantity')) || 1)),
          budget: initial?.budget ?? null,
          reason:
            initial?.reason ??
            (params.has('source') ? '来自已录衣橱的数量缺口，仍需核对未录入及替代方案。' : ''),
          notes: initial?.notes ?? '',
          status: initial?.status === 'purchased' ? 'purchased' : 'planned',
          source_ids:
            initial?.sources.map((s) => s.id) ??
            (params.has('source') ? [params.get('source')!] : []),
        }
  })
  const [dirty, setDirty] = useState(!!operation.pending)
  const [error, setError] = useState('')
  const [reading, setReading] = useState(false)
  const configs = useQuery({ queryKey: ['inventory-configs'], queryFn: getConfigs })
  const sources =
    configs.data?.flatMap((p) =>
      p.rows
        .filter((r) => r.enabled)
        .map((r) => ({ id: r.id, name: r.name, season: p.season, active: true })),
    ) ?? []
  const allSources = [
    ...sources,
    ...(initial?.sources ?? []).filter((s) => !sources.some((r) => r.id === s.id)),
  ]
  const change = (value: Partial<SupplyInput>) => {
    setDraft((d) => ({ ...d, ...value }))
    setDirty(true)
  }
  useEffect(() => {
    if (saved) navigate(`/wardrobe/organization/plans/${id}`, { replace: true })
  }, [saved, navigate, id])
  return (
    <section className="organization-page">
      <PageHeader
        title={initial ? '编辑补充计划' : '新增补充计划'}
        backTo={initial ? `/wardrobe/organization/plans/${id}` : '/wardrobe/organization'}
        backLabel="返回补充计划"
      />
      <p className="organization-help">先记下需要，再逐件入库。数量与预算都可以以后调整。</p>
      {initial && ['completed', 'cancelled'].includes(initial.status) && (
        <p className="notice">
          编辑保存会重新计算剩余计划，已有 {initial.linked.length} 件入库关联会保留。
        </p>
      )}
      <form
        className="organization-form"
        onSubmit={(e) => {
          e.preventDefault()
          const parsed = supplyInputSchema.safeParse(draft)
          if (!parsed.success) {
            setError('请检查名称、整数数量及预算（最多两位小数）。')
            return
          }
          setError('')
          operation.send(`/supply-plans/${id}`, 'POST', parsed.data)
        }}
      >
        <fieldset disabled={operation.busy || reading} className="organization-card">
          <legend>补充什么</legend>
          <label>
            计划名称
            <input
              required
              maxLength={80}
              value={draft.name}
              onChange={(e) => change({ name: e.target.value })}
            />
          </label>
          <div className="organization-form-grid">
            <label>
              计划数量
              <input
                required
                type="number"
                inputMode="numeric"
                min={Math.max(1, initial?.linked.length ?? 0)}
                max={10000}
                step={1}
                value={draft.quantity || ''}
                onChange={(e) => change({ quantity: Number(e.target.value) })}
              />
            </label>
            <label>
              总预算（元，可不填）
              <input
                type="number"
                min={0}
                max={99999999.99}
                step="0.01"
                inputMode="decimal"
                value={draft.budget ?? ''}
                onChange={(e) => change({ budget: e.target.value || null })}
              />
            </label>
          </div>
          <label>
            计划状态
            <select
              aria-label="计划状态"
              value={draft.status}
              onChange={(e) => change({ status: e.target.value as SupplyInput['status'] })}
            >
              <option value="planned">计划中</option>
              <option value="purchased">已购待入库</option>
            </select>
          </label>
          <p className="organization-help">
            标记已购不增加库存。完成录入并关联单品后，计划才计为完成。
          </p>
          <label>
            补充理由
            <textarea
              maxLength={500}
              value={draft.reason}
              onChange={(e) => change({ reason: e.target.value })}
            />
          </label>
        </fieldset>
        <fieldset disabled={operation.busy || reading} className="organization-card">
          <legend>用途与补充说明</legend>
          <details className="organization-disclosure" open={draft.source_ids.length > 0}>
            <summary>关联季节需求 · {draft.source_ids.length} 项</summary>
            <p className="muted">同一批衣服可满足不同季节或用途；不要为每行重复建计划。</p>
            {configs.error && (
              <p role="alert">
                {configs.error.message}
                <Button onClick={() => void configs.refetch()}>重试需求选项</Button>
              </p>
            )}
            {configs.isPending && <p role="status">正在读取季节需求…</p>}
            {configs.data && !allSources.length && (
              <p className="muted">还没有启用的需求，可先保存手工计划，之后再关联。</p>
            )}
            {allSources.map((s) => (
              <label className="organization-check" key={s.id}>
                <input
                  type="checkbox"
                  checked={draft.source_ids.includes(s.id)}
                  disabled={!s.active && !draft.source_ids.includes(s.id)}
                  onChange={(e) =>
                    change({
                      source_ids: e.target.checked
                        ? [...draft.source_ids, s.id]
                        : draft.source_ids.filter((id) => id !== s.id),
                    })
                  }
                />
                {seasonLabel(s.season)}季 · {s.name}
                {!s.active && '（已停用，来源保留）'}
              </label>
            ))}
          </details>
          <details
            className="organization-disclosure"
            open={!!initial?.notes || !!operation.pending}
          >
            <summary>添加备注（可选）</summary>
            <label>
              备注
              <textarea
                maxLength={2000}
                value={draft.notes}
                onChange={(e) => change({ notes: e.target.value })}
              />
            </label>
          </details>
        </fieldset>
        {error && (
          <p role="alert" className="error">
            {error}
          </p>
        )}
        <OperationNotice operation={operation} />
        {(operation.error || operation.pending) && (
          <Button
            variant="outline"
            disabled={operation.sending || reading}
            onClick={async () => {
              setReading(true)
              try {
                const latest = await getSupply(id)
                operation.discard()
                change({ expected_version: latest.version })
              } catch (e) {
                setError(e instanceof Error ? e.message : '读取失败')
              } finally {
                setReading(false)
              }
            }}
          >
            保留输入并读取最新版本
          </Button>
        )}
        <div className="organization-save">
          <Button type="submit" disabled={operation.busy || reading}>
            {operation.sending ? '正在保存…' : '保存补充计划'}
          </Button>
        </div>
      </form>
      <DraftGuard dirty={dirty && !saved} sending={operation.sending} />
    </section>
  )
}
