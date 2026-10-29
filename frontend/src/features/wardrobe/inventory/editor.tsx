import { seasonalReturn } from '../return-context'
import { useEffect, useRef, useState } from 'react'
import { useBlocker, useLocation, useNavigate, useParams, useSearchParams } from 'react-router'
import { useQuery } from '@tanstack/react-query'
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import { Button } from '../../../components/ui/button'
import { PageHeader } from '../../../components/ui/page-header'
import { Sheet } from '../../../components/ui/sheet'
import { OperationNotice } from '../../../components/ui/operation-notice'
import { useOperation } from '../../../lib/use-operation'
import { getTags, getTaxonomy } from '../api'
import { getSubtypes } from '../lifecycle-api'
import { DemandForm } from './demand-form'
import { InventoryContext } from './editor-context'
import {
  getInventory,
  newDemand,
  planInputSchema,
  seasons,
  seasonSchema,
  targetLabel,
  type Demand,
  type Plan,
} from './api'
import '../wardrobe-controls.css'
import './inventory.css'
import './editor.css'

export function InventoryEditorPage() {
  const returnTo = seasonalReturn(useLocation().state)
  const season = seasonSchema.catch('spring').parse(useParams().season)
  const query = useQuery({ queryKey: ['inventory', season], queryFn: () => getInventory(season) })
  if (!query.data)
    return (
      <section className="inventory-page">
        <PageHeader
          title="编辑本季目标"
          backTo={returnTo ?? `/wardrobe/inventory?season=${season}`}
          backLabel={returnTo?.startsWith('/wardrobe/seasonal/') ? '返回本轮整理' : '返回盘点'}
        />
        <p role={query.error ? 'alert' : 'status'}>{query.error?.message ?? '正在读取目标…'}</p>
        {query.error && <Button onClick={() => void query.refetch()}>重新读取</Button>}
      </section>
    )
  return <InventoryDraft key={season} initial={query.data.plan} />
}

function InventoryDraft({ initial }: { initial: Plan }) {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const returnTo =
    seasonalReturn(useLocation().state) ?? `/wardrobe/inventory?season=${initial.season}`
  const [saved, setSaved] = useState(false)
  const operation = useOperation(`inventory.${initial.season}`, () => {
    setDirty(false)
    setRowDirty(false)
    setSaved(true)
  })
  const [draft, setDraft] = useState<Plan>(() => {
    const pending = planInputSchema.safeParse(operation.pending?.body)
    return pending.success
      ? { ...pending.data, season: initial.season, version: pending.data.expected_version }
      : initial
  })
  const [dirty, setDirty] = useState(!!operation.pending)
  const [editing, setEditing] = useState<Demand | null>(
    () => initial.rows.find((r) => r.id === params.get('row')) ?? null,
  )
  const [rowDirty, setRowDirty] = useState(false)
  const [discardRow, setDiscardRow] = useState(false)
  const [removing, setRemoving] = useState<string | null>(null)
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [readingLatest, setReadingLatest] = useState(false)
  const focus = useRef<HTMLElement | null>(null)
  const taxonomy = useQuery({ queryKey: ['taxonomies'], queryFn: getTaxonomy })
  const subtypes = useQuery({ queryKey: ['garment-subtypes'], queryFn: getSubtypes })
  const tags = useQuery({ queryKey: ['tags'], queryFn: getTags })
  useEffect(() => {
    if (params.has('row'))
      focus.current = document.getElementById(`edit-demand-${params.get('row')}`)
  }, [params])
  const blocked = dirty || rowDirty || operation.sending
  const blocker = useBlocker(blocked && !saved)
  useEffect(() => {
    if (saved) navigate(returnTo, { replace: true })
  }, [saved, navigate, returnTo])
  useEffect(() => {
    if (!blocked) return
    const prevent = (event: BeforeUnloadEvent) => event.preventDefault()
    window.addEventListener('beforeunload', prevent)
    return () => window.removeEventListener('beforeunload', prevent)
  }, [blocked])
  const change = (value: Plan) => {
    setDraft(value)
    setDirty(true)
    setError('')
  }
  const open = (row: Demand) => {
    focus.current = document.activeElement as HTMLElement
    setEditing(row)
    setRowDirty(false)
  }
  const move = (index: number, offset: number) => {
    const rows = [...draft.rows]
    const target = rows.splice(index, 1)[0]
    rows.splice(index + offset, 0, target)
    change({ ...draft, rows })
    setNotice(`已将“${target.name}”移至第 ${index + offset + 1} 条，保存后生效。`)
  }
  const send = () => {
    const parsed = planInputSchema.safeParse({
      city: draft.city,
      period: draft.period,
      notes: draft.notes,
      rows: draft.rows,
      expected_version: draft.version,
    })
    if (!parsed.success) {
      setError('请检查需求名称、完整目标区间及行数（最多 100 行）。')
      return
    }
    operation.send(`/inventory/${initial.season}`, 'POST', parsed.data)
  }
  return (
    <section className="inventory-page">
      <PageHeader
        title={`编辑${seasons[initial.season]}季目标`}
        backTo={returnTo}
        backLabel={returnTo?.startsWith('/wardrobe/seasonal/') ? '返回本轮整理' : '返回盘点'}
      />
      <p className="inventory-draft-note">先调整需求，最后统一保存。实际库存会根据衣服重新核算。</p>
      <fieldset disabled={operation.busy || readingLatest} className="inventory-editor-fields">
        <div className="inventory-section-title">
          <h2>需求清单 · {draft.rows.length} 条</h2>
          <Button
            variant="outline"
            disabled={draft.rows.length >= 100}
            onClick={() => open(newDemand())}
          >
            <Plus size={18} aria-hidden="true" />
            新增需求
          </Button>
        </div>
        {!draft.rows.length && <p className="panel">还没有需求，先添加一条。目标数量允许留空。</p>}
        {draft.rows.map((row, index) => (
          <article
            className={`inventory-draft-row ${!row.enabled ? 'is-disabled' : ''}`}
            key={row.id}
          >
            <div className="inventory-draft-heading">
              <span className="inventory-row-number" aria-hidden="true">
                {String(index + 1).padStart(2, '0')}
              </span>
              <div>
                <h3>{row.name}</h3>
                <p>
                  {taxonomy.data?.fields.category[row.category] ?? row.category} ·{' '}
                  {targetLabel(row)}
                  {!row.enabled && ' · 已停用'}
                </p>
              </div>
              <Button id={`edit-demand-${row.id}`} variant="outline" onClick={() => open(row)}>
                编辑需求
              </Button>
            </div>
            <details className="inventory-row-options">
              <summary>排序与删除</summary>
              <div className="inventory-row-tools">
                <Button
                  variant="outline"
                  disabled={index === 0}
                  aria-label={`上移${row.name}`}
                  onClick={() => move(index, -1)}
                >
                  <ArrowUp size={16} aria-hidden="true" />
                  上移
                </Button>
                <Button
                  variant="outline"
                  disabled={index === draft.rows.length - 1}
                  aria-label={`下移${row.name}`}
                  onClick={() => move(index, 1)}
                >
                  <ArrowDown size={16} aria-hidden="true" />
                  下移
                </Button>
                <Button
                  variant="outline"
                  aria-label={`删除${row.name}`}
                  onClick={() => setRemoving(row.id)}
                >
                  <Trash2 size={16} aria-hidden="true" />
                  删除
                </Button>
              </div>
            </details>
          </article>
        ))}
        <InventoryContext
          draft={draft}
          change={change}
          onNotice={setNotice}
          onError={setError}
          initiallyCopy={params.get('copy') === '1'}
        />
      </fieldset>
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <OperationNotice operation={operation} />
      {(operation.error || operation.pending) && (
        <Button
          variant="outline"
          disabled={operation.sending || readingLatest}
          onClick={async () => {
            setReadingLatest(true)
            try {
              const latest = await getInventory(initial.season)
              operation.discard()
              setDraft((d) => ({ ...d, version: latest.plan.version }))
              setNotice('已读取最新版本，保留你的草稿。保存将使用当前草稿，请核对其他页面的修改。')
            } catch (e) {
              setError(e instanceof Error ? e.message : '读取失败，草稿已保留。')
            } finally {
              setReadingLatest(false)
            }
          }}
        >
          保留草稿并读取最新版本
        </Button>
      )}
      <div className="inventory-save-bar">
        <span>{dirty ? '有未保存的修改' : '目标配置未修改'}</span>
        <Button disabled={operation.busy || readingLatest || !dirty} onClick={send}>
          {operation.sending ? '正在保存…' : '保存本季目标'}
        </Button>
      </div>
      <Sheet
        title={editing?.name || '新增需求'}
        open={!!editing}
        finalFocus={focus}
        trigger={<button type="button" hidden />}
        onOpenChange={(open) => {
          if (!open) {
            if (rowDirty) setDiscardRow(true)
            else setEditing(null)
          }
        }}
      >
        {(taxonomy.error || tags.error || subtypes.error) && (
          <p role="alert">
            部分选项读取失败，已有选择会保留。
            <Button
              onClick={() => {
                void taxonomy.refetch()
                void tags.refetch()
                void subtypes.refetch()
              }}
            >
              重新读取选项
            </Button>
          </p>
        )}
        {editing && (
          <DemandForm
            key={editing.id}
            initial={editing}
            fields={taxonomy.data?.fields ?? {}}
            subtypes={subtypes.data ?? []}
            tags={tags.data ?? []}
            busy={operation.busy}
            onDirty={() => setRowDirty(true)}
            onApply={(row) => {
              change({
                ...draft,
                rows: draft.rows.some((r) => r.id === row.id)
                  ? draft.rows.map((r) => (r.id === row.id ? row : r))
                  : [...draft.rows, row],
              })
              setEditing(null)
              setRowDirty(false)
            }}
          />
        )}
      </Sheet>
      <Sheet
        title="删除这条需求？"
        open={!!removing}
        trigger={<button hidden type="button" />}
        onOpenChange={(open) => {
          if (!open) setRemoving(null)
        }}
      >
        <p>
          将“{draft.rows.find((r) => r.id === removing)?.name}
          ”从本季草稿移除，衣服和分类会保留。关联的补充计划保留原来源，并标记来源已停用。保存本季目标后生效。
        </p>
        <Button
          variant="outline"
          onClick={() => {
            change({ ...draft, rows: draft.rows.filter((r) => r.id !== removing) })
            setRemoving(null)
          }}
        >
          从草稿移除
        </Button>
      </Sheet>
      <Sheet
        title={operation.sending ? '正在保存，请稍候' : '放弃未保存的修改？'}
        open={discardRow || blocker.state === 'blocked'}
        trigger={<button hidden type="button" />}
        onOpenChange={(open) => {
          if (!open) {
            setDiscardRow(false)
            if (blocker.state === 'blocked') blocker.reset()
          }
        }}
      >
        <p>
          {discardRow
            ? '只放弃当前需求面板的输入，本季其他草稿会保留。'
            : '离开会放弃未保存的草稿；结果未确认的原请求仍可重发。'}
        </p>
        <Button
          onClick={() => {
            setDiscardRow(false)
            if (blocker.state === 'blocked') blocker.reset()
          }}
        >
          继续编辑
        </Button>
        <Button
          variant="outline"
          disabled={operation.sending}
          onClick={() => {
            setDiscardRow(false)
            setEditing(null)
            setRowDirty(false)
            if (blocker.state === 'blocked') blocker.proceed()
          }}
        >
          放弃修改
        </Button>
      </Sheet>
    </section>
  )
}
